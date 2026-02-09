const MODULE_ID = "table-quantities";

// For TEXT type results: [[/r 1d4]]@UUID[Item.xxx]{Display Name}
const TEXT_PATTERN = /\[\[\/r\s+([^\]]+)\]\]\s*@UUID\[([^\]]+)\]\{([^}]*)\}/;

// For DOCUMENT type results: just [[/r 1d4]] in the description field
const ROLL_PATTERN = /\[\[\/r\s+([^\]]+)\]\]/;

const MAX_RECURSION_DEPTH = 10;

/**
 * WeakMap storing quantity data for processed results.
 * Keyed by TableResult document, value is {quantity, documentUuid, name}.
 * We never mutate the result documents themselves — this avoids breaking
 * Foundry's DataModel proxies and downstream consumers like Item Piles.
 */
const resultQuantities = new WeakMap();

/**
 * Map of documentUuid → Array of pending quantities.
 * Populated during processResult for Item results, consumed by the
 * preCreateItem hook to apply quantities when items are actually created
 * (e.g. by Item Piles populating a vendor inventory).
 * Uses an array (queue) so multiple draws of the same item each get their
 * own rolled quantity applied in order.
 */
const pendingQuantities = new Map();

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

async function evaluateFormula(formula) {
  const roll = new Roll(formula.trim());
  await roll.evaluate();
  return roll.total;
}

/* ---------------------------------------- */
/*  Result Parsing                           */
/* ---------------------------------------- */

/**
 * Parse a table result for a quantity pattern. Handles:
 * 1. DOCUMENT type: [[/r formula]] in description, documentUuid has the target
 * 2. TEXT type: [[/r formula]]@UUID[...]{Name} in description
 */
function parseQuantityResult(result) {
  const description = result.description ?? "";

  if (result.type === "document" && result.documentUuid) {
    const rollMatch = description.match(ROLL_PATTERN);
    if (rollMatch) {
      return { formula: rollMatch[1], uuid: result.documentUuid, name: result.name };
    }
  }

  if (result.type === "text") {
    const fullMatch = description.match(TEXT_PATTERN);
    if (fullMatch) {
      return { formula: fullMatch[1], uuid: fullMatch[2], name: fullMatch[3] };
    }
  }

  return null;
}

/* ---------------------------------------- */
/*  Result Processing                        */
/* ---------------------------------------- */

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
    // Store quantity on the original result in case anyone needs it
    resultQuantities.set(result, {
      quantity,
      documentUuid: parsed.uuid,
      name: parsed.name,
      expandedToSubResults: true
    });
    return subResults;
  }

  // --- Item reference: store quantity and ensure result is document-type ---
  if (doc instanceof Item) {
    // If this was a text-type result with an embedded UUID, promote it to
    // a document-type result so that Item Piles (and other consumers that
    // expect documentUuid) can process it without crashing on deprecated
    // v13 shims.
    if (result.type === "text") {
      result.updateSource({
        type: "document",
        documentUuid: parsed.uuid,
        name: parsed.name,
        description: "",
        img: doc.img ?? null
      });
    }

    resultQuantities.set(result, {
      quantity,
      documentUuid: parsed.uuid,
      name: parsed.name
    });

    // Queue the quantity so the preCreateItem hook can apply it
    if (!pendingQuantities.has(parsed.uuid)) {
      pendingQuantities.set(parsed.uuid, []);
    }
    pendingQuantities.get(parsed.uuid).push(quantity);

    return [result];
  }

  console.warn(`${MODULE_ID} | Unsupported document type for UUID: ${parsed.uuid}`);
  return [result];
}

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
/*  Chat Message                             */
/* ---------------------------------------- */

/**
 * Build a custom chat message showing quantity results.
 * Only called when modifyChat is enabled and there are quantities to show.
 */
async function sendQuantityChat(table, results, roll, rollMode) {
  const quantityEntries = results
    .map(r => resultQuantities.get(r))
    .filter(Boolean);

  if (!quantityEntries.length) return;

  const lines = quantityEntries.map(q => `<li>${q.quantity}x @UUID[${q.documentUuid}]{${q.name}}</li>`);
  const content = `<div class="table-quantities-results"><ul>${lines.join("")}</ul></div>`;

  const enrichedContent = await TextEditor.enrichHTML(content);
  await ChatMessage.create({
    flavor: `Table Quantities from <strong>${table.name}</strong>`,
    content: enrichedContent,
    speaker: ChatMessage.getSpeaker(),
    whisper: rollMode === "gmroll" ? game.users.filter(u => u.isGM).map(u => u.id) : undefined
  });
}

/* ---------------------------------------- */
/*  RollTable.prototype.draw Wrapper         */
/* ---------------------------------------- */

async function wrappedDraw(wrapped, options = {}) {
  let drawResult;
  try {
    // Let the original draw run completely (including its own chat message)
    drawResult = await wrapped(options);

    // Post-process results for quantity patterns
    drawResult.results = await processResults(drawResult.results);

    // Send an additional chat message with rolled quantities if enabled
    const wantChat = options.displayChat !== false;
    const modifyChat = game.settings.get(MODULE_ID, "modifyChat");
    if (wantChat && modifyChat) {
      await sendQuantityChat(this, drawResult.results, drawResult.roll, options.rollMode);
    }

    // Fire hook so other modules can consume the processed results
    Hooks.callAll(`${MODULE_ID}.resultsReady`, drawResult.results, resultQuantities);
  } catch (err) {
    console.error(`${MODULE_ID} | Error processing table draw:`, err);
    // If our processing fails, re-run the original draw unmodified
    if (!drawResult) drawResult = await wrapped(options);
  }

  return drawResult;
}

function monkeyPatchDraw() {
  const original = RollTable.prototype.draw;
  RollTable.prototype.draw = async function (options = {}) {
    let drawResult;
    try {
      drawResult = await original.call(this, options);
      drawResult.results = await processResults(drawResult.results);

      const wantChat = options.displayChat !== false;
      const modifyChat = game.settings.get(MODULE_ID, "modifyChat");
      if (wantChat && modifyChat) {
        await sendQuantityChat(this, drawResult.results, drawResult.roll, options.rollMode);
      }

      Hooks.callAll(`${MODULE_ID}.resultsReady`, drawResult.results, resultQuantities);
    } catch (err) {
      console.error(`${MODULE_ID} | Error processing table draw:`, err);
      if (!drawResult) drawResult = await original.call(this, options);
    }

    return drawResult;
  };
}

/* ---------------------------------------- */
/*  Public API                               */
/* ---------------------------------------- */

const api = {
  processResults,
  parseQuantityResult,

  /**
   * Get quantity data for a result, if any was rolled.
   * @param {TableResult} result
   * @returns {{quantity: number, documentUuid: string, name: string}|undefined}
   */
  getQuantity(result) {
    return resultQuantities.get(result);
  },

  /**
   * The WeakMap containing all quantity data keyed by TableResult.
   */
  resultQuantities,

  TEXT_PATTERN,
  ROLL_PATTERN
};

/* ---------------------------------------- */
/*  Initialization                           */
/* ---------------------------------------- */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Table Quantities`);
  registerSettings();

  game.modules.get(MODULE_ID).api = api;

  if (typeof libWrapper !== "undefined") {
    libWrapper.register(MODULE_ID, "RollTable.prototype.draw", wrappedDraw, "WRAPPER");
  } else {
    monkeyPatchDraw();
  }

  // Apply rolled quantities when items are created (e.g. by Item Piles)
  Hooks.on("preCreateItem", (item, data, options) => {
    // Determine the source UUID — Item Piles and Foundry use flags.core.sourceId
    const sourceId = data?.flags?.core?.sourceId ?? item.flags?.core?.sourceId;
    if (!sourceId) return;

    const queue = pendingQuantities.get(sourceId);
    if (!queue || !queue.length) return;

    // Consume the next pending quantity for this UUID
    const quantity = queue.shift();
    if (!queue.length) pendingQuantities.delete(sourceId);

    const quantityPath = game.settings.get(MODULE_ID, "quantityPath");
    foundry.utils.setProperty(data, quantityPath, quantity);
    console.log(`${MODULE_ID} | Applied quantity ${quantity} to ${data.name ?? item.name} via ${quantityPath}`);
  });
});
