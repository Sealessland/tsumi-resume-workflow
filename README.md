# 简历预览与投递归档工作流

两条可独立使用的本地流程：将简历 JSON 导入 [Tsumi Resume Studio](https://github.com/kakerusan/tsumi_resume) 预览、导出 PDF；在招聘网页确认投递成功后，通过浏览器扩展和本机桥接服务把岗位写入自己的飞书多维表格。公开提交不包含渲染器源码、真实简历、飞书 Base 标识或投递记录。

## 环境

- Node.js 22+、npm、Google Chrome（默认命令 `google-chrome-stable`）。
- 简历预览需要单独安装 Tsumi Resume Studio。该项目在此仓库之外运行；本仓库仅使用其“导入 JSON”入口。
- 投递归档需要浏览器扩展、已按用户身份登录且具备目标 Base 权限的 `lark-cli`，以及自己创建的飞书 Base/数据表。

## 1. 本地预览简历

```bash
git clone https://github.com/kakerusan/tsumi_resume.git ~/tsumi_resume
npm --prefix ~/tsumi_resume install
cp agent-dev.example.json agent-dev.json
npm run resume:open
```

`agent-dev.json` 是**本地唯一默认简历输入**，已被 Git 忽略。把自己的简历 JSON 放到这个路径；公开的 `agent-dev.example.json` 仅为虚构演示数据，不包含真实个人经历。已有其他 JSON 时也可运行 `npm run resume:open -- ./other-resume.json`。`npm run resume:open -- --dry-run` 只显示导入计划，不启动浏览器。

脚本在 `~/tsumi_resume` 启动本地开发服务器，打开独立 Chrome 窗口，并通过工作台的“导入 JSON”文件入口一次性加载本地文件；不向远端上传，不持续同步文件。导入后在浏览器核对内容、A4 溢出提示，再按渲染器的“导出 PDF”操作生成投递文件。可选 `TSUMI_CHROME_BIN` 指定浏览器可执行文件、`TSUMI_RESUME_ORIGIN` 指定本地渲染器地址；无界面环境可设 `TSUMI_RESUME_HEADLESS=1`，并配合 `TSUMI_RESUME_SCREENSHOT=/tmp/resume.png` 检查页面。不要把真实 JSON、截图或 PDF 提交到公开仓库。

## 2. 投递成功后归档

1. 在自己的飞书 Base 建立投递记录表，包含字段：`公司`、`岗位`、`投递日期`、`当前状态`、`下一步`、`下次跟进时间`、`岗位链接`、`备注`。`当前状态` 为单选，须有 `已投递` 选项；日期字段支持 `YYYY-MM-DD HH:mm:ss`；其他字段按用途设为文本/链接。若另建公式字段（如 `归档状态`），它不属于可写字段。本工作流**不会**上传简历附件或创建任何示例记录。
2. 登录 `lark-cli`，确认可用 `lark-cli base +field-list --as user --base-token <BASE_TOKEN> --table-id <TABLE_ID> --format json` 查看实际字段。复制 `archive.config.example.json` 为 `archive.config.json`，填入**自己的** `baseToken`、`tableId`，以及八个字段名对应的真实 `field_id`。本地配置已被 Git 忽略；桥接服务启动时检查配置，写入前再次读取字段并比对名称、ID 和可写类型。
3. 生成本机密钥并启动桥接服务：

   ```bash
   export FEISHU_ARCHIVE_SECRET="$(openssl rand -hex 32)"
   node bridge/server.js
   ```

4. 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展”，指向本仓库的 `extension/`。在扩展“连接设置”输入同一密钥。仅在招聘页面明确显示投递成功后，核对公司、岗位、链接并点击“确认成功并归档”。自动归档默认关闭；若开启，请注意网页提示可能误判，应核对飞书记录。

扩展仅向本机 `127.0.0.1:43118` 发请求。桥接服务要求扩展来源与本机密钥，调用当前用户的 `lark-cli`；写入前校验真实字段 ID，不写公式字段，创建记录后按返回的 `record_id` 回读。无法从招聘页确定的公司/岗位留空，不根据域名猜测。扩展不识别实际投递的简历版本；需要关联 PDF 时，使用自己的附件上传流程。

## 验证

```bash
npm test
npm run resume:open -- --dry-run
```

本仓库使用 MIT 许可证；外部简历渲染器及 `lark-cli` 依其各自的条款提供，不包含在本仓库的许可范围内。
