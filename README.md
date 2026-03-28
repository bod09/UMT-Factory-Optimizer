# UMT Factory Optimizer

A web-based tool for **Ultimate Mining Tycoon** (Roblox) that helps you build the most profitable factory possible.

**Live Site:** [bod09.github.io/UMT-Factory-Optimizer](https://bod09.github.io/UMT-Factory-Optimizer/)

## Features

### Factory Optimizer
- Automatically discovers the most profitable processing chains for your current mining depth
- Configurable mining zone, depth range, and factory budget
- Accounts for all prestige items, Robux items, and the duplicator
- Shows detailed node-based graphs of each chain with flow quantities
- Tracks byproduct chains (stone, dust, gems, ceramics) and finds their optimal use
- Calculates per-ore value including all byproduct income

### Factory Builder
- Interactive node-based factory builder with drag-and-drop
- Full machine sidebar with category filters and search
- Click a placed node to filter the sidebar to compatible machines
- Live value calculation as you build
- Drag nodes to reorder, drag to trash to delete

### Prestige Speedrun
- Fastest path from a fresh prestige to target prestige level
- Accounts for XXL Backpack ownership (skips backpack purchases)
- Step-by-step upgrade order

### Upgrade Paths
- Early game to end game progression guides
- Adapts to your current prestige items

### Item Database
- Complete database of all machines, their inputs, outputs, and effects
- Machine connection map showing what can feed into what
- Editable via `data/machines.json`

## Data-Driven Architecture

All calculations run from `data/machines.json` - no hardcoded chains. The optimizer:

1. Reads machine data (inputs, outputs, effects, costs, tags)
2. Recursively resolves the best production path for each sellable item
3. Tests duplicator placement at every position in every chain
4. Evaluates all byproduct processing paths (stone, dust, gems)
5. Ranks chains by per-ore profit including byproduct income

### Editing Machine Data

To add or fix machines, edit `data/machines.json`. Each machine has:

```json
{
  "machine_id": {
    "name": "Display Name",
    "cost": 1000,
    "category": "metalwork",
    "inputs": ["bar"],
    "outputs": [{ "type": "plate", "chance": 1.0 }],
    "byproducts": [{ "type": "stone", "chance": 1.0 }],
    "byproductRatio": 0.5,
    "effect": "flat|multiply|percent|set|combine|chance",
    "value": 20,
    "tag": "tag_name"
  }
}
```

Changes to this file automatically update all calculations and graphs.

## Tag System

Tags prevent exploit loops and track item state:

| Tag | Applied By | Removed By | Notes |
|-----|-----------|------------|-------|
| Cleaned | Ore Cleaner | Crusher | +$10 flat bonus |
| Polished | Polisher | Crusher | +$10 flat bonus |
| Smelted | Ore Smelter | - | Prevents re-smelting |
| Tempered | Tempering Forge | Crusher | 2x value |
| Gold_Infused | Philosopher's Stone | Crusher | +25% value |
| Upgraded | Ore Upgrader | Crusher | Upgrades ore tier |
| Sifted | Sifter/Nano Sifter | - | Prevents re-sifting |
| Duplicated | Duplicator | - | 2 copies at 50% value |
| Unduplicatable | Duplicator | - | Persists through crusher |

Items inherit all tags from their ingredients when combined. The Crusher removes most tags (except Unduplicatable), enabling re-processing.

## Tech Stack

Pure HTML/CSS/JavaScript - no build tools, no frameworks, no dependencies. Hosted on GitHub Pages.

## Contributing

1. Fork the repo
2. Edit `data/machines.json` to fix machine data or add new machines
3. Submit a pull request

Game data sourced from the [UMT Wiki](https://umt.miraheze.org/).
