# AMLL Player Append Folder

> 提供了将文件夹添加到AMLL Player中的方式。可选择**歌手**、**专辑**、**文件夹**作为播放列表名称，也可以使用现有的播放列表。

> [!TIP]
>
> 选择**文件夹**作为播放列表名称时，由于播放列表不能像文件夹一样嵌套，所以只会添加文件夹中的直属文件，子文件夹中的歌曲会添加到单独播放列表。

## 开始使用

### 下载已编译好的插件

前往 [Github Actions](../../actions) 页面，在最新编译中下载编译好的插件包，将插件解压至插件目录[^1]下。

### 自行编译插件

使用`git clone`命令将项目克隆至本地后，使用`pnpm i`安装需要的依赖包，接着使用以下命令**之一**编译至`dist`文件夹，移动到插件目录[^1]下。

```bash
pnpm build:dev # Build plugin with source map
pnpm build:src # Build minified plugin with source map
pnpm build # Build minified plugin without source map
```

[^1]: C:\Users\用户名\AppData\Roaming\net.stevexmh.amllplayer\extensions