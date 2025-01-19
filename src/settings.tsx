import {atom, useAtom} from "jotai";
import {type FC, PropsWithChildren, useEffect} from "react";
import chalk from "chalk";
import {Button, Card, Flex, Select, Text, TextField, TextProps} from "@radix-ui/themes";
import {ArchiveIcon} from "@radix-ui/react-icons"
import {open} from "@tauri-apps/plugin-dialog";
import {toast, ToastContainer} from "react-toastify";
import {platform} from "@tauri-apps/plugin-os";
import {exists, stat, readDir} from "@tauri-apps/plugin-fs";
import {join} from '@tauri-apps/api/path';
import {db, Playlist, Song} from "./dexie";
import md5 from "md5";
import {readLocalMusicMetadata} from "./utils/player";
import {path} from "@tauri-apps/api";
import { useLiveQuery } from "dexie-react-hooks";
import React from "react";

const WARN_TAG = chalk.bgHex("#ee6900").hex("#FFFFFF")(" WARN ");
const INFO_TAG = chalk.bgHex("#4764e0").hex("#FFFFFF")(" INFO ");
const NAME_TAG = chalk.bgHex("#36a3c9").hex("#FFFFFF")(" SONG ");

export function consoleLog(type: string, func: string, info: string) {

    if (type === "INFO") {
        console.log(NAME_TAG + INFO_TAG, func + "::" + info)

    } else if (type === "WARN") {
        console.log(NAME_TAG + WARN_TAG, func + "::" + info)

    } else if (type === "LOG") {
        console.log(NAME_TAG + NAME_TAG, func + "::" + info)

    } else {
        console.log(NAME_TAG + WARN_TAG, func + "::" + info)
    }

}

const folderAtom = atom("");
const modAtom = atom("$songArtists");

export const SettingPage: FC = () => {
    const playlists:Playlist[] = useLiveQuery(() => db.playlists.toArray(), [], []);
    const [folder, setFolder] = useAtom(folderAtom)
    const [mod, setMod] = useAtom(modAtom);

    consoleLog('LOG', 'playlist', playlists.map(v=>JSON.stringify(v)).join(', '));

    async function selectFolder() {
        const results = await open({
            directory: true,
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
            return consoleLog('WARN', 'folder', `错误的文件夹路径：${folder}`);
        }
        const fileInfo = await stat(folder)
        if (!fileInfo.isDirectory) {
            toast.warning(<>不是文件夹<br/>{folder}</>,);
            return consoleLog('WARN', 'folder', `不是文件夹：${folder}`);
        }

        const foundAudioFiles: string[] = [];

        async function scanFiles(folderPath: string) {
            // 判断文件是否是音频文件
            function isAudioFile(fileName: string) {
                const audioExtensions = ["mp3", "flac", "wav", "m4a", "aac", "ogg"];
                return audioExtensions.some(ext => fileName.endsWith(ext));
            }

            if (platform() !== "android" && platform() !== "ios") {
                folderPath = folderPath.replace(/\\/gi, "/");
            }

            try {
                // 读取目录内容
                consoleLog('INFO', 'path', folderPath);
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
                            consoleLog('INFO', 'file', fullPath);
                            toast.info(<>扫描到文件<br/>{fullPath}</>,);
                        }
                }
            } catch (err) {
                toast.error(<>扫描文件时出错<br/>{err}</>,);
                console.error('Error scanning files:', err);
            }
        }

        const sid = toast.loading(<>开始扫描文件夹<br/>{folder}</>,)
        await scanFiles(folder)
        toast.done(sid)

        async function appendFiles() {
            let current = 0;
            let success = 0;
            let errored = 0;
            const transformed = (
                await Promise.all(
                    foundAudioFiles.map(async (v) => {
                        let normalized = v;
                        console.log(v);
                        if (platform() !== "android" && platform() !== "ios") {
                            normalized = (await path.normalize(v)).replace(/\\/gi, "/");
                        }
                        try {
                            // console.log(await stat(v));
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
                            consoleLog("WARN", normalized, "解析歌曲元数据以添加歌曲失败" + err);
                            console.log(err);
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
            await db.songs.bulkPut(transformed);
            if (mod.startsWith('$')) {
                const listInDb = playlists.map(v=>v.name);
                if (mod == '$songArtists') {
                    const artists = [...new Set(transformed.map(v=>v.songArtists))];

                    consoleLog('LOG', 'append', '自动创建播放列表' + artists.join(', '));
                    artists.filter(v=>!listInDb.includes(v)).forEach(v=> db.playlists.add({
                            name: v,
                            createTime: Date.now(),
                            updateTime: Date.now(),
                            playTime: 0,
                            songIds: [],
                    }));

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

                    consoleLog('LOG', 'append', '自动创建播放列表' + albums.join(', '));
                    albums.filter(v=>!listInDb.includes(v)).forEach(v => db.playlists.add({
                        name: v,
                        createTime: Date.now(),
                        updateTime: Date.now(),
                        playTime: 0,
                        songIds: [],
                    }));

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

            if (errored > 0 && success > 0) {
                toast.warn(`已添加 ${success} 首歌曲，剩余 ${errored} 首歌曲添加失败`, );
            } else if (success === 0) {
                toast.error(`${errored} 首歌曲添加失败`, );
            } else {
                toast.success(`已全部添加 ${success} 首歌曲`, );
            }
        }

        const lid = toast.loading(`正在解析音乐元数据以添加歌曲 ${foundAudioFiles.length} / 0`)
        await appendFiles();
        toast.done(lid);
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
                <Select.Root defaultValue="$songArtists" onValueChange={(v)=>setMod(v)}>
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
            limit={5}
            pauseOnHover={false}
            autoClose={500}/>
    </div>
}