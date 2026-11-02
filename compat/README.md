# Flow 引用菜单兼容

`flow-reference-list.patch` 为 `comfyui_libtv_xyq/web/cloudgen_at.js` 的引用菜单增加可选的 `__terryBusListEntries()` 接口支持，使“总线转列表”中的图片按实际顺序显示文件名和缩略图。普通列表逻辑及列表实际输出保持原样。

这是 Flow 插件的配套补丁，安装 TerryXu 节点包不会自动改写其他插件。已经支持该接口的 Flow 版本无需再应用补丁。

在 ComfyUI 的 `custom_nodes` 目录中，用 PowerShell 7 执行：

```powershell
$PatchPath = (Resolve-Path -LiteralPath './ComfyUI-TerryXu-nodes/compat/flow-reference-list.patch').Path
git -C ./comfyui_libtv_xyq apply --no-index --check $PatchPath
if ($LASTEXITCODE -eq 0) {
    git -C ./comfyui_libtv_xyq apply --no-index $PatchPath
}
```

成功应用后刷新 ComfyUI 页面即可。若检查不通过，可能是补丁已应用或 Flow 版本不同；不要强制覆盖文件。
