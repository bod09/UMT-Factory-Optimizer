# UMT Factory Optimizer

A community-built tool for **Ultimate Mining Tycoon** (Roblox) that helps you build the most profitable factory possible.

**Live Site:** [bod09.github.io/UMT-Factory-Optimizer](https://bod09.github.io/UMT-Factory-Optimizer/)

> **For accurate, up-to-date game data, visit the [UMT Wiki](https://umt.miraheze.org/).** This tool uses the wiki as its source of truth. If you find incorrect data here, please help by updating the wiki first - our automated updater will pull the changes in.

## Features

### Factory Optimizer
- Automatically discovers the most profitable processing chains for any mining depth or specific ore
- Interactive node-based flow graphs showing every machine, quantity, and connection
- Accounts for all prestige items (Philosopher's Stone, Ore Upgrader, Transmuters, Duplicator, Nano Sifter)
- Handles byproduct chains (stone, dust, gems, ceramics) as part of one unified flow
- Finds optimal duplicator placement and excess item routing
- Supports batch mode (total profit for N ores) and per-ore comparison
- Bar-to-Gem enhancement path with Prismatic Gem Crucible

### Progression Guide
- Dynamic stage-by-stage factory progression from fresh start to prestige
- Each stage shows the best factory chain at that budget with node graphs
- Accounts for starting money from prestige upgrades
- Prestige cost table

### Item Database
- Complete database of all machines with inputs, outputs, effects, and costs
- Machine connection map showing compatible chains
- Ore and gem stats with depth ranges

## How It Works

All calculations run from `data/machines.json` - no hardcoded chains. The system:

1. **FlowOptimizer** resolves the best value for every item type using multi-pass iterative convergence
2. **ChainDiscoverer** finds all terminal products and builds complete processing chains
3. **Duplicator testing** evaluates every possible placement for maximum profit
4. **Byproduct evaluation** finds the best destination for every secondary output
5. **Graph visualization** uses topological forward propagation for accurate quantities

### Automated Wiki Updates

A GitHub Action runs weekly (+ manual trigger) to check the [UMT Wiki](https://umt.miraheze.org/) for game changes:
- Fetches machine data via MediaWiki API
- Safely merges: updates wiki fields (name, cost, description) without overwriting custom optimizer data
- Creates a PR with a diff report for review
- Detects active game events and their associated machines

## Data Accuracy

This tool derives its game data from the **[UMT Wiki](https://umt.miraheze.org/)**, maintained by the community. If you notice incorrect values:

1. **Check the wiki first** - it may already be updated
2. **Update the wiki** if you have correct info - the wiki helps everyone
3. **Edit `data/machines.json`** in this repo for optimizer-specific fixes
4. **Submit a PR** with your changes

The wiki is the single source of truth for game data. Our automated updater syncs changes weekly.

## Editing Machine Data

To add or fix machines, edit `data/machines.json`:

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

Tags track item state and prevent exploit loops:

| Tag | Applied By | Removed By | Notes |
|-----|-----------|------------|-------|
| Cleaned | Ore Cleaner | Crusher | +$10 flat bonus |
| Polished | Polisher | Crusher | +$10 flat bonus |
| Smelted | Ore Smelter | - | Prevents re-smelting |
| Tempered | Tempering Forge | Crusher | 2x value |
| Gold_Infused | Philosopher's Stone | Crusher | +25% value |
| Upgraded | Ore Upgrader | Crusher | Upgrades ore tier |
| Sifted | Sifter/Nano Sifter | - | Prevents re-sifting dust |
| Duplicated | Duplicator | - | 2 copies at 50% value |
| Unduplicatable | Duplicator | - | Persists through crusher |

Items inherit all tags from their ingredients when combined. The Crusher removes most tags (except Unduplicatable).

## Tech Stack

Pure HTML/CSS/JavaScript - no build tools, no frameworks, no dependencies. Hosted on GitHub Pages.

## Attribution & License

### Game Data
Game data is sourced from the **[Ultimate Mining Tycoon Wiki](https://umt.miraheze.org/)** and is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Thank you to the wiki contributors who maintain accurate game information.

The wiki is hosted on [Miraheze](https://miraheze.org/), a free wiki hosting platform. Consider [donating to Miraheze](https://miraheze.org/donate) to support the wiki infrastructure.

### Code
The optimizer code (algorithms, UI, visualization) is licensed under the [MIT License](LICENSE).

### Game
Ultimate Mining Tycoon is developed by **Innovation Inc** (Rolijok & Madattak). This is a community fan project - not affiliated with or endorsed by the developers.

## Contributing

1. **Help the wiki** - Update [umt.miraheze.org](https://umt.miraheze.org/) with accurate game data
2. **Fix optimizer data** - Edit `data/machines.json` and submit a PR
3. **Report issues** - Open an issue on GitHub
4. **Improve the code** - Fork, fix, and PR
