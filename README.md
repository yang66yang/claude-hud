# Claude HUD



## 安装步骤

### 前置要求

- Claude Code v1.0.80+
- Node.js 18+ 或 Bun

### 手动配置

直接编辑 `~/.claude/plugins/claude-hud/config.json` 进行高级设置，如 `colors.*`、`pathLevels`、阈值覆盖等。运行 `/claude-hud:configure` 会保留这些手动设置。


### 配置示例

```json
 "statusLine": {
    "type": "command",
    "command": "bash -c 'plugin_dir=$(ls -d \"$HOME\"/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1); exec bun \"$plugin_dir/dist/index.js\"'"
  },
```

## 开发

```bash
git clone https://github.com/yang66yang/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```


 "statusLine": {
    "type": "command",
    "command": "bash -c 'plugin_dir=$(ls -d \"$HOME\"/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1); exec bun \"$plugin_dir/dist/index.js\"'"
  },




---

## 许可证

MIT — 详见 [LICENSE](LICENSE)

---

## Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=yang66yang/claude-hud&type=Date)](https://star-history.com/#yang66yang/claude-hud&Date)
