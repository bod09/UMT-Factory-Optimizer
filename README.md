# UMT Factory Optimizer

A community-built tool for **Ultimate Mining Tycoon** (Roblox) that helps you build the most profitable factory possible.

**Live Site:** [bod09.github.io/UMT-Factory-Optimizer](https://bod09.github.io/UMT-Factory-Optimizer/)

> **For accurate, up-to-date game data, visit the [UMT Wiki](https://umt.miraheze.org/).** If you find incorrect data here, please help by updating the wiki first - our automated updater will pull the changes in.

## Features

### Factory Optimizer
- Select any ore and see the most profitable processing chains ranked by profit
- Interactive node-based flow graphs showing every machine, quantity, and connection
- Accounts for all prestige items (Philosopher's Stone, Ore Upgrader, Transmuters, Duplicator, Nano Sifter)
- Unified flow: byproduct chains (stone, dust, gems, ceramics) integrated into the main chain
- Optimal duplicator placement and excess item routing
- Batch mode for total profit comparison
- "Best Possible" toggle to see what's achievable with all prestige items

### Progression Guide
- Stage-by-stage factory progression from fresh start to prestige
- Best factory chain at each budget with node graphs
- Accounts for starting money from prestige upgrades
- Prestige cost table

### Item Database
- All machines with inputs, outputs, effects, and costs
- Machine connection map
- Ore and gem stats with depth ranges

## Data-Driven

All calculations run from `data/machines.json` - no hardcoded chains. The flow optimizer automatically discovers the best processing path for every item type, including byproduct routing and duplicator placement.

### Automated Wiki Updates

A GitHub Action checks the [UMT Wiki](https://umt.miraheze.org/) weekly for game changes:
- Updates machine data (name, cost, description) without overwriting optimizer-specific fields
- Creates a PR with a diff report for review
- Detects active game events and their machines

## Data Accuracy

Game data comes from the **[UMT Wiki](https://umt.miraheze.org/)**. If you notice incorrect values:

1. **Update the wiki** - it helps everyone and our updater will sync it
2. **Edit `data/machines.json`** for optimizer-specific fixes
3. **Submit a PR** or open an issue

## Tech Stack

Pure HTML/CSS/JavaScript - no build tools, no frameworks, no dependencies. Hosted on GitHub Pages.

## Attribution & License

**Game Data:** Sourced from the [UMT Wiki](https://umt.miraheze.org/) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The wiki is hosted on [Miraheze](https://miraheze.org/) - consider [donating](https://miraheze.org/donate) to support it.

**Code:** [MIT License](LICENSE)

**Game:** Ultimate Mining Tycoon is developed by Innovation Inc (Rolijok & Madattak). This is a community fan project - not affiliated with the developers.

## Contributing

1. **Help the wiki** - Update [umt.miraheze.org](https://umt.miraheze.org/) with accurate game data
2. **Fix data** - Edit `data/machines.json` and submit a PR
3. **Report issues** - Open an issue on GitHub
