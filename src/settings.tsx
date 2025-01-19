import {atom, useAtom} from "jotai";
import {type FC, PropsWithChildren, useEffect} from "react";
import chalk from "chalk";
import {Button, Card, Flex, Select, Text, TextField, TextProps} from "@radix-ui/themes";
import {ArchiveIcon} from "@radix-ui/react-icons"
import {open} from "@tauri-apps/plugin-dialog";
import {Id, toast, ToastContainer, ToastContent, ToastOptions} from "react-toastify";
import {platform} from "@tauri-apps/plugin-os";
import {exists, stat, readDir} from "@tauri-apps/plugin-fs";
import {join} from '@tauri-apps/api/path';
import {db, Playlist, Song} from "./dexie";
import md5 from "md5";
import {readLocalMusicMetadata} from "./utils/player";
import {path, window} from "@tauri-apps/api";
import { useLiveQuery } from "dexie-react-hooks";
import React from "react";

const WARN_TAG = chalk.bgHex("#ee6900").hex("#FFFFFF")(" WARN ");
const INFO_TAG = chalk.bgHex("#4764e0").hex("#FFFFFF")(" INFO ");
const  LOG_TAG = chalk.bgHex("#36a3c9").hex("#FFFFFF")(" LOG ");
const NAME_TAG = chalk.bgHex("#8b8d98").hex("#FFFFFF")(" SONG ");

function getChalk(bg: string, fg: string, func: string) {
    return chalk.bgHex(bg).hex(fg)(` ${func} `);
}

export function consoleLog(type: string, func: string, info: string) {

    const FUNC_TAG = getChalk("#ff587c", "#FFFFFF", func);
    if (type === "INFO") {
        console.log(NAME_TAG + INFO_TAG + FUNC_TAG, info)

    } else if (type === "WARN") {
        console.log(NAME_TAG + WARN_TAG + FUNC_TAG, info)

    } else if (type === "LOG") {
        console.log(NAME_TAG + LOG_TAG + FUNC_TAG, info)

    } else {
        console.log(NAME_TAG + NAME_TAG + FUNC_TAG, info)
    }

}

const folderAtom = atom("");
const modAtom = atom("$songArtists");

export const SettingPage: FC = () => {
    const playlists:Playlist[] = useLiveQuery(() => db.playlists.toArray(), [], []);
    const [folder, setFolder] = useAtom(folderAtom)
    const [mod, setMod] = useAtom(modAtom);

    // consoleLog('LOG', 'playlist', playlists.map(v=>JSON.stringify(v)).join(', '));

    const toastList: Id[] = [];
    const toastSet: Set<Id> = new Set<Id>([]);

    async function selectFolder() {
        const results = await open({
            directory: true,
            recursive: true,
        });
        if (!results) return;

        setFolder(results);
    }

    async function loadFolder() {
        if (!folder) return;
        try {
            await exists(folder)
        } catch (e) {
            toast.warning(<>错误的文件夹路径<br/>{folder}</>,);
            return consoleLog('WARN', 'path', `错误的文件夹路径：${folder}`);
        }
        const fileInfo = await stat(folder)
        if (!fileInfo.isDirectory) {
            toast.warning(<>不是文件夹<br/>{folder}</>,);
            return consoleLog('WARN', 'path', `不是文件夹：${folder}`);
        }

        const foundAudioFiles: string[] = [];
        let falid:string[] = [];

        async function scanFiles(folderPath: string) {
            // 判断文件是否是音频文件
            function isAudioFile(fileName: string) {
                const audioExtensions = ["mp3", "flac", "wav", "m4a", "aac", "ogg"];
                return audioExtensions.some(ext => fileName.endsWith(ext));
            }

            if (platform() !== "android" && platform() !== "ios") {
                folderPath = folderPath.replace(/\\/gi, "/");
            }

            toast.update(sid, {
                render: <>开始扫描文件夹<br/>{folderPath}</>,
            });

            try {
                // 读取目录内容
                consoleLog('LOG', 'folder', folderPath);
                const files = await readDir(folderPath);
                // 遍历文件和文件夹
                for (let file of files) {
                    const fullPath = await join(folderPath, file.name);
                        if (file.isDirectory) {
                            // 如果是目录，递归扫描
                            await scanFiles(fullPath);
                        } else if (file.isFile && isAudioFile(file.name)) {
                            // 如果是音频文件，加入结果
                            foundAudioFiles.push(fullPath);
                            consoleLog('LOG', 'file', fullPath);
                            toast.update(fid, {
                                render: <>扫描到文件<br/>{fullPath}</>,
                            });
                        }
                }
            } catch (err) {
                falid.push(folderPath);
                toast.warning(<>扫描文件时出错<br/>{err}</>, {position: "bottom-left"});
                console.error('Error scanning files:', err);
            }
        }

        const sid = toast.info('', {autoClose: false});
        const fid = toast.info('', {autoClose: false});
        await scanFiles(folder);
        toast.update(sid, {render: '文件扫描结束', autoClose: 800});
        toast.update(fid, {render: '目录遍历结束', autoClose: 800});

        async function appendFiles() {
            let current = 0;
            let success = 0;
            let errored = 0;
            let faliedList: string[] = [];
            const transformed = (
                await Promise.all(
                    foundAudioFiles.map(async (v) => {
                        let normalized = v;
                        // console.log(v);
                        if (platform() !== "android" && platform() !== "ios") {
                            normalized = (await path.normalize(v)).replace(/\\/gi, "/");
                        }
                        try {
                            consoleLog('INFO', 'song', JSON.stringify(await stat(v)));
                            const pathMd5 = md5(normalized);
                            const musicInfo = await readLocalMusicMetadata(normalized);

                            const coverData = new Uint8Array(musicInfo.cover);
                            const coverBlob = new Blob([coverData], {type: "image"});

                            success += 1;
                            return {
                                id: pathMd5,
                                filePath: normalized,
                                songName: musicInfo.name,
                                songArtists: musicInfo.artist,
                                songAlbum: musicInfo.album,
                                lyricFormat: musicInfo.lyricFormat || "none",
                                lyric: musicInfo.lyric,
                                cover: coverBlob,
                                duration: musicInfo.duration,
                            } satisfies Song;
                        } catch (err) {
                            errored += 1;
                            faliedList.push(normalized);
                            consoleLog("WARN", 'file', normalized + "解析歌曲元数据以添加歌曲失败\n" + err);
                            // console.log(err);
                            return null;
                        } finally {
                            current += 1;
                            toast.update(lid, {
                                render: `正在解析音乐元数据以添加歌曲 ${foundAudioFiles.length} / ${current}`,
                                progress: current / foundAudioFiles.length,
                            });
                        }
                    }),
                )
            ).filter((v) => !!v);
            const aid = toast.info(<>解析完毕，开始添加到列表</>, {autoClose: false});
            await db.songs.bulkPut(transformed);
            if (mod.startsWith('$')) {
                const listInDb = playlists.map(v=>v.name);
                if (mod == '$songArtists') {
                    const artists = [...new Set(transformed.map(v=>v.songArtists))];

                    artists.filter(v=>!listInDb.includes(v)).forEach(v=> {
                        db.playlists.add({
                            name: v,
                            createTime: Date.now(),
                            updateTime: Date.now(),
                            playTime: 0,
                            songIds: [],
                        })
                        consoleLog('LOG', 'indexDB', '自动创建播放列表：' + v);
                    });

                    const newPlaylists = await db.playlists.toArray();
                    // 使用 reduce 方法将数组转换为 Map，key 为 name，value 为 Playlist 对象
                    const idMap = newPlaylists.filter(v=>artists.includes(v.name)).reduce((map, playlist) => {
                        map.set(playlist.name, playlist);
                        return map;
                    }, new Map<string, Playlist>());
                    for (const [name, list] of idMap) {
                        const shouldAddIds = transformed
                            .filter(v=>name == v.songArtists)
                            .filter(v=>!list?.songIds.includes(v.id))
                            .map(v=>v.id)
                            .reverse();
                        await db.playlists.update(list.id, (obj) => { obj.songIds.unshift(...shouldAddIds); });
                    }
                } else {
                    const albums = [...new Set(transformed.map(v=>v.songAlbum))];

                    albums.filter(v=>!listInDb.includes(v)).forEach(v => {
                        db.playlists.add({
                            name: v,
                            createTime: Date.now(),
                            updateTime: Date.now(),
                            playTime: 0,
                            songIds: [],
                        })
                        consoleLog('LOG', 'indexDB', '自动创建播放列表：' + v);
                    });

                    const newPlaylists = await db.playlists.toArray();
                    // 使用 reduce 方法将数组转换为 Map，key 为 name，value 为 Playlist 对象
                    const idMap = newPlaylists.filter(v=>albums.includes(v.name)).reduce((map, playlist) => {
                        map.set(playlist.name, playlist);
                        return map;
                    }, new Map<string, Playlist>());
                    for (const [name, list] of idMap) {
                        const shouldAddIds = transformed
                            .filter(v=>name == v.songAlbum)
                            .filter(v=>!list?.songIds.includes(v.id))
                            .map(v=>v.id)
                            .reverse();
                        await db.playlists.update(list.id, (obj) => { obj.songIds.unshift(...shouldAddIds); });
                    }
                }
            } else {
                const playlist = await db.playlists.get(Number(mod.slice(1)));
                const shouldAddIds = transformed
                    .map((v) => v.id)
                    .filter((v) => !playlist?.songIds.includes(v))
                    .reverse();
                await db.playlists.update(Number(mod.slice(1)), (obj) => {
                    obj.songIds.unshift(...shouldAddIds);
                });
            }
            toast.dismiss(aid);

            if (errored > 0 && success > 0) {
                consoleLog('WARN', 'file', '\n' + faliedList.join('\n'));
                toast.warn(<>已添加 {success} 首歌曲，剩余 {errored} 首歌曲添加失败<br/>请按F12查看控制台日志</>, );
            } else if (success === 0) {
                toast.error(`${errored} 首歌曲添加失败`, );
            } else {
                toast.success(`已全部添加 ${success} 首歌曲`, );
            }
        }

        const lid = toast.info(`正在解析音乐元数据以添加歌曲 ${foundAudioFiles.length} / 0`, {autoClose: false});
        await appendFiles();
        toast.update(lid, {autoClose: 800, type: "info"});
        if (falid.length) {
            consoleLog('WARN', 'folder', '\n' + falid.join('\n'));
            toast.error(<>有{falid.length}个文件夹扫描失败<br/>请按F12查看控制台日志并重新扫描</>, {autoClose: false});
        }
    }

    useEffect(() => {
        console.log("SettingPage Loaded");
    }, []);

    // 前置组件
    const SubTitle: FC<PropsWithChildren<TextProps>> = ({ children, ...props }) => {
        return (
            <Text weight="bold" size="4" my="4" as="div" {...props}>
                {children}
            </Text>
        );
    };
    
    return <div>
        <SubTitle>从文件夹添加歌曲</SubTitle>
        <Card mt="2">
            <Flex direction="row" align="center" gap="4" my="2">
                <Text as="div">选择文件夹</Text>
                <Flex direction="column" flexGrow="1">
                    <TextField.Root
                        value={folder}
                        onChange={(e)=>setFolder(e.currentTarget.value)}
                    />
                </Flex>
                <Button
                    radius="large"
                    color="indigo"
                    variant="soft"
                    onClick={()=>selectFolder()}>
                    <ArchiveIcon />
                </Button>
            </Flex>
            <Flex direction="row" align="end" gap="4" my="2">
                <Flex direction="column" flexGrow="1">
                    <Text as="div">添加到播放列表</Text>
                </Flex>
                <Select.Root defaultValue={mod} onValueChange={(v)=>setMod(v)}>
                    <Select.Trigger />
                    <Select.Content>
                        <Select.Group>
                            <Select.Label>自动列表</Select.Label>
                            <Select.Item value="$songArtists">对应歌手</Select.Item>
                            <Select.Item value="$songAlbum">对应专辑</Select.Item>
                        </Select.Group>
                        <Select.Separator />
                        <Select.Group>
                            <Select.Label>现有列表</Select.Label>
                            {playlists.map((playlist) => (
                                <Select.Item value={'#' + playlist.id}>
                                    {playlist.name}
                                </Select.Item>
                            ))}
                        </Select.Group>
                    </Select.Content>
                </Select.Root>
                <Button
                    color="cyan"
                    variant="soft"
                    onClick={()=>loadFolder()}>
                    开始导入
                </Button>
            </Flex>
        </Card>
        <ToastContainer
            position={'bottom-right'}
            pauseOnHover={false}/>
    </div>
}