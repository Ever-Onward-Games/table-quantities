const MODULE_ID = "table-quantities";

// Matches: [[/r 1d4]]@UUID[Item.xxx]{Display Name}
// Group 1: dice formula, Group 2: UUID, Group 3: display name
const QUANTITY_PATTERN = /\[\[\/r\s+([^\]]+)\]\]\s*@UUID\[([^\]]+)\]\{([^}]*)\}/;

const MAX_RECURSION_DEPTH = 10;

/* ---------------------------------------- */
/*  Settings Registration                    */
/* ---------------------------------------- */

function registerSettings() {
  game.settings.register(MODULE_ID, "quantityPath", {
    name: "TABLE_QUANTITIES.SettingQuantityPath",
    hint: "TABLE_QUANTITIES.SettingQuantityPathHint",
    scope: "world",
    config: true,
    type: String,
    default: "system.quantity"
  });

  game.settings.register(MODULE_ID, "modifyChat", {
    name: "TABLE_QUANTITIES.SettingModifyChat",
    hint: "TABLE_QUANTITIES.SettingModifyChatHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

/* ---------------------------------------- */
/*  Dice Rolling                             */
/* ---------------------------------------- */

/**
 * Evaluate a dice formula string and return the total.
 * @param {string} formula - e.g. "1d4", "2d6+1"
 * @returns {Promise<number>}
 */
async function evaluateFormula(formula) {
  const roll = new Roll(formula.trim());
  await roll.evaluate();
  return roll.total;
}

/* ---------------------------------------- */
/*  Result Processing                        */
/* ---------------------------------------- */

/**
 * Parse a table result's text for the quantity pattern.
 * @param {string} text - The result text field
 * @returns {{formula: string, uuid: string, name: string}|null}
 */
function parseQuantityText(text) {
  if (!text) return null;
  const match = text.match(QUANTITY_PATTERN);
  if (!match) return null;
  return {
    formula: match[1],
    uuid: match[2],
    name: match[3]
  };
}

/**
 * Process a single table result that matches the quantity pattern.
 * For Item UUIDs: attaches quantity data to the result.
 * For RollTable UUIDs: recursively draws from the sub-table.
 *
 * @param {TableResult} result - The drawn TableResult document
 * @param {object} parsed - Output of parseQuantityText
 * @param {number} depth - Current recursion depth
 * @returns {Promise<TableResult[]>} Processed result(s)
 */
async function processResult(result, parsed, depth) {
  const quantity = await evaluateFormula(parsed.formula);
  if (quantity <= 0) return [result];

  const doc = await fromUuid(parsed.uuid);
  if (!doc) {
    console.warn(`${MODULE_ID} | Could not resolve UUID: ${parsed.uuid}`);
    return [result];
  }

  // --- RollTable reference: draw from sub-table N times ---
  if (doc instanceof RollTable) {
    if (depth >= MAX_RECURSION_DEPTH) {
      console.warn(`${MODULE_ID} | Max recursion depth reached for table: ${parsed.name}`);
      return [result];
    }
    const subResults = [];
    for (let i = 0; i < quantity; i++) {
      const draw = await doc.draw({ displayChat: false, recursive: true });
      // Recursively process sub-results in case they also have quantity patterns
      const processed = await processResults(draw.results, depth + 1);
      subResults.push(...processed);
    }
    return subResults;
  }

  // --- Item reference: attach quantity to result ---
  if (doc instanceof Item) {
    const modifyChat = game.settings.get(MODULE_ID, "modifyChat");

    // Store quantity data in flags on the result object (in-memory, not persisted to DB)
    result.flags = result.flags ?? {};
    result.flags[MODULE_ID] = {
      quantity,
      documentUuid: parsed.uuid,
      originalText: result.text
    };

    // Optionally update displayed text
    if (modifyChat) {
      result.text = `${quantity}x ${parsed.name}`;
    }

    return [result];
  }

  // Unknown document type — return unmodified
  console.warn(`${MODULE_ID} | Unsupported document type for UUID: ${parsed.uuid}`);
  return [result];
}

/**
 * Process an array of table results, expanding quantity patterns.
 * @param {TableResult[]} results
 * @param {number} [depth=0]
 * @returns {Promise<TableResult[]>}
 */
async function processResults(results, depth = 0) {
  const processed = [];
  for (const result of results) {
    const parsed = parseQuantityText(result.text);
    if (parsed) {
      const expanded = await processResult(result, parsed, depth);
      processed.push(...expanded);
    } else {
      processed.push(result);
    }
  }
  return processed;
}

/* ---------------------------------------- */
/*  RollTable.prototype.draw Wrapper         */
/* ---------------------------------------- */

/**
 * Wrapped draw function that post-processes results for quantity patterns.
 * @param {Function} wrapped - The original draw method (from libWrapper) or not used (monkey-patch)
 * @param {object} [options={}]
 * @returns {Promise<{roll: Roll, results: TableResult[]}>}
 */
async function wrappedDraw(wrapped, options = {}) {
  const drawResult = await wrapped(options);

  // Post-process results for quantity patterns
  drawResult.results = await processResults(drawResult.results);

  // Fire hook so other modules can consume the processed results
  Hooks.callAll(`${MODULE_ID}.resultsReady`, drawResult.results);

  return drawResult;
}

/**
 * Monkey-patch fallback when libWrapper is not available.
 */
function monkeyPatchDraw() {
  const original = RollTable.prototype.draw;
  RollTable.prototype.draw = async function (options = {}) {
    const drawResult = await original.call(this, options);
    drawResult.results = await processResults(drawResult.results);
    Hooks.callAll(`${MODULE_ID}.resultsReady`, drawResult.results);
    return drawResult;
  };
}

/* ---------------------------------------- */
/*  Public API                               */
/* ---------------------------------------- */

const api = {
  /**
   * Manually process an array of TableResult objects for quantity patterns.
   * @param {TableResult[]} results
   * @returns {Promise<TableResult[]>}
   */
  processResults,

  /**
   * Parse a text string for the quantity pattern.
   * @param {string} text
   * @returns {{formula: string, uuid: string, name: string}|null}
   */
  parseQuantityText,

  /**
   * The regex pattern used to detect quantity syntax.
   */
  QUANTITY_PATTERN
};

/* ---------------------------------------- */
/*  Initialization                           */
/* ---------------------------------------- */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Table Quantities`);
  registerSettings();

  // Expose public API
  game.modules.get(MODULE_ID).api = api;

  // Wrap RollTable.prototype.draw
  if (typeof libWrapper !== "undefined") {
    libWrapper.register(MODULE_ID, "RollTable.prototype.draw", wrappedDraw, "WRAPPER");
  } else {
    monkeyPatchDraw();
  }
});
