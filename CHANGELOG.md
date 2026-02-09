# Changelog

## Version 1.0.0-beta.5

### Changes
- Fix: Clear description field when promoting text→document results (fixes raw formula HTML leaking into item names)
- Feature: Apply rolled quantities to items via `preCreateItem` hook (fixes items always having quantity 1 in Item Piles)

## Version 1.0.0-beta.4

### Changes
- Fix: Promote text-type results to document-type via `updateSource()` to prevent Item Piles crash on null `documentUuid`

## Version 1.0.0-beta.3

### Changes
- Fix: Use WeakMap for quantity storage instead of mutating result documents
- Fix: Let original `draw()` complete before post-processing, add separate quantity chat message
- Fix: Add try/catch safety wrapper around draw processing

## Version 1.0.0-beta.2

### Changes
- Fix: Use v13 `result.description` and `result.name` instead of deprecated `result.text`
- Support both DOCUMENT-type and TEXT-type table results

## Version 1.0.0-beta.1

### Changes
- Initial release
- Parse `[[/r dice]]@UUID[...]` syntax in RollTable result text
- Item references: roll dice and store quantity in result flags
- RollTable references: recursively draw from sub-tables N times
- Configurable item quantity path (default: system.quantity)
- Configurable chat display of quantities
- libWrapper support with monkey-patch fallback
- Public API for other modules to consume
