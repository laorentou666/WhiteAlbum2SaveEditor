# WHITE ALBUM2 Save Editor

Windows 桌面存档管理器，支持 WHITE ALBUM2 PC 版与澄空 / CK-GAL 汉化版。

## 功能

- 展示全部 100 个存档槽位，包括空槽。
- 拖动存档到空槽，或在已占用槽位间重排。
- 显示存档日期、缩略图、中文摘要和 IC / CC / CODA 章节。
- 移动、复制和删除前自动创建 `.bak` 备份。
- 自动发现 `Documents\Leaf\WHITE ALBUM2`，也可手动选择目录。

## 使用

从 GitHub Releases 下载 portable EXE 后直接运行，无需安装。程序不会附带游戏本体或汉化补丁。

## 本地开发

需要 Node.js 20 或更高版本：

```powershell
npm install
npm run install:app
npm test
npm run dev
```

构建免安装版：

```powershell
npm run dist:portable
```

产物位于 `release\`。

## 数据安全

文件操作默认保留备份，并通过同目录临时文件或临时路径完成原子重命名。仍建议在批量整理前额外备份整个存档目录。

---

感谢`hoshino-yui`大佬做出的贡献 (hoshino-yui/wa2recode)

~~沟槽的electron，终于见识到厉害了，这么个小软件编译出来居然要60MB~~
