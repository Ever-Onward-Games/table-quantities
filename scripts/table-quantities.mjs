const MODULE_ID = "table-quantities";

// For TEXT type results: [[/r 1d4]]@UUID[Item.xxx]{Display Name}
// Group 1: dice formula, Group 2: UUID, Group 3: display name
const TEXT_PATTERN = /\[\[\/r\s+([^\]]+)\]\]\s*@UUID\[([^\]]+)\]\{([^}]*)\}/;

// For DOCUMENT type results: just [[/r 1d4]] in the description field
// Group 1: dice formula
const ROLL_PATTERN = /\[\[\/r\s+([^\]]+)\]\]/;

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
/*  Result Parsing                           */
/* ---------------------------------------- */

/**
 * Parse a table result for a quantity pattern. Handles two cases:
 *
 * 1. DOCUMENT type: description contains [[/r formula]], documentUuid has the target
 * 2. TEXT type: description contains [[/r formula]]@UUID[...]{Name}
 *
 * @param {TableResult} result - A v13 TableResult document
 * @returns {{formula: string, uuid: string, name: string}|null}
 */
function parseQuantityResult(result) {
  const description = result.description ?? "";

  // Case 1: Document type result — formula in description, UUID on the result itself
  if (result.type === "document" && result.documentUuid) {
    const rollMatch = description.match(ROLL_PATTERN);
    if (rollMatch) {
      return {
        formula: rollMatch[1],
        uuid: result.documentUuid,
        name: result.name
      };
    }
  }

  // Case 2: Text type result — full pattern in description
  if (result.type === "text") {
    const fullMatch = description.match(TEXT_PATTERN);
    if (fullMatch) {
      return {
        formula: fullMatch[1],
        uuid: fullMatch[2],
        name: fullMatch[3]
      };
    }
  }

  return null;
}

/* ---------------------------------------- */
/*  Result Processing                        */
/* ---------------------------------------- */

/**
 * Process a single table result that matches a quantity pattern.
 * For Item UUIDs: attaches quantity data to the result flags.
 * For RollTable UUIDs: recursively draws from the sub-table.
 *
 * @param {TableResult} result - The drawn TableResult document
 * @param {object} parsed - Output of parseQuantityResult
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
      const processed = await processResults(draw.results, depth + 1);
      subResults.push(...processed);
    }
    return subResults;
  }

  // --- Item reference: attach quantity to result flags ---
  if (doc instanceof Item) {
    // Store quantity data in flags (in-memory only, not persisted to DB)
    result.flags = result.flags ?? {};
    result.flags[MODULE_ID] = {
      quantity,
      documentUuid: parsed.uuid,
      name: parsed.name,
      originalDescription: result.description
    };
    return [result];
  }

  // Unknown document type
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
    const parsed = parseQuantityResult(result);
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
 * Wrapped draw function. Suppresses the original chat message, processes
 * results for quantity patterns, then sends its own chat message with
 * quantity-modified descriptions.
 *
 * @param {Function} wrapped - The original draw method (libWrapper)
 * @param {object} [options={}]
 * @returns {Promise<{roll: Roll, results: TableResult[]}>}
 */
async function wrappedDraw(wrapped, options = {}) {
  const wantChat = options.displayChat !== false;

  // Suppress the original chat message so we can modify results first
  const drawResult = await wrapped({ ...options, displayChat: false });

  // Post-process results for quantity patterns
  drawResult.results = await processResults(drawResult.results);

  // Send chat message with quantity info
  if (wantChat) {
    const modifyChat = game.settings.get(MODULE_ID, "modifyChat");
    const savedDescriptions = new Map();

    // Temporarily rewrite descriptions to show rolled quantities
    if (modifyChat) {
      for (const result of drawResult.results) {
        const qtyData = result.flags?.[MODULE_ID];
        if (qtyData?.quantity) {
          savedDescriptions.set(result, result.description);
          result.description = `${qtyData.quantity}x @UUID[${qtyData.documentUuid}]{${qtyData.name}}`;
        }
      }
    }

    await this.toMessage(drawResult.results, {
      roll: drawResult.roll,
      messageOptions: { rollMode: options.rollMode }
    });

    // Restore original descriptions so the DB documents aren't polluted
    for (const [result, originalDesc] of savedDescriptions) {
      result.description = originalDesc;
    }
  }

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
    const wantChat = options.displayChat !== false;
    const drawResult = await original.call(this, { ...options, displayChat: false });

    drawResult.results = await processResults(drawResult.results);

    if (wantChat) {
      const modifyChat = game.settings.get(MODULE_ID, "modifyChat");
      const savedDescriptions = new Map();

      if (modifyChat) {
        for (const result of drawResult.results) {
          const qtyData = result.flags?.[MODULE_ID];
          if (qtyData?.quantity) {
            savedDescriptions.set(result, result.description);
            result.description = `${qtyData.quantity}x @UUID[${qtyData.documentUuid}]{${qtyData.name}}`;
          }
        }
      }

      await this.toMessage(drawResult.results, {
        roll: drawResult.roll,
        messageOptions: { rollMode: options.rollMode }
      });

      for (const [result, originalDesc] of savedDescriptions) {
        result.description = originalDesc;
      }
    }

    Hooks.callAll(`${MODULE_ID}.resultsReady`, drawResult.results);
    return drawResult;
  };
}

/* ---------------------------------------- */
/*  Public API                               */
/* ---------------------------------------- */

const api = {
  processResults,
  parseQuantityResult,
  TEXT_PATTERN,
  ROLL_PATTERN
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
