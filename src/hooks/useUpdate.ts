import { ref } from "vue";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useLogger } from "./useLogger";

//import { platform as appPlatform } from "@tauri-apps/plugin-os";

/**
 * Hook: 应用更新管理
 * 提供检查、下载、安装并重启的完整流程
 * https://juejin.cn/post/7506832196582408226
 * https://juejin.cn/post/7504577132736987174
 */
export function useUpdate() {
  // 日志
  const log = useLogger();
  const promiseTry = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);

  // 更新信息响应式存储
  const updateInfo = ref<Update | null>(null);

  /**
   * 检查远程更新
   * @param platform - 请求头 Platform 值，例如 "windows-x86_64"
   * @returns boolean - 是否发现可用更新
   */
  async function checkForUpdates(): Promise<boolean> {
    try {
      //const platform = appPlatform();
      // 发起检查请求
      const result = await check({ headers: { Platform: "windows-x86_64" } });
      updateInfo.value = result;
      log.info("检查更新结果:", result);
      if (!result) {
        return false;
      }
      // 检查版本号是否大于当前版本
      const current = await getVersion();
      return shouldUpdate(current, { version: result.version });
    } catch (e) {
      log.error("检查更新失败:", e);
      return false;
    }
  }

  /**
   * 下载并安装更新，完成后可选重启
   * @param autoRelaunch - 下载完成后是否自动重启，默认为 false
   */
  async function downloadAndInstall(autoRelaunch = false): Promise<void> {
    // if (!updateInfo.value) {
    //   console.warn("未发现更新或未执行检查");
    //   return;
    // }
    const result = updateInfo.value ?? await check({ headers: { Platform: "windows-x86_64" } });
    updateInfo.value = result;
    if (!result) {
      log.info("当前已是最新版本");
      return;
    }
    try {
      // 使用 downloadAndInstall 简化下载+安装流程，并监听进度事件
      await promiseTry(() => result.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          log.info(`开始下载，总大小: ${event.data.contentLength}`);
          return;
        }
        if (event.event === "Progress") {
          log.info(`已下载: ${event.data.chunkLength}`);
          return;
        }
        if (event.event === "Finished") {
          log.info("下载完成");
        }
      }));
      log.info("更新安装完成");
      if (autoRelaunch) {
        await relaunch();
      }
    } catch (e) {
      log.error("下载或安装更新失败:", e);
    }
  }

  return {
    /**
     * 触发更新检查，返回是否需要更新
     */
    checkForUpdates,
    /**
     * 下载并安装最新更新
     */
    downloadAndInstall,
    updateInfo
  };
}

/**
 * 判断是否需要更新
 * @param current - 当前版本号
 * @param update - 插件返回的更新信息对象
 * @returns true: 有可用更新
 */
export function shouldUpdate(current: string, update: { version: string }): boolean {
  return compareVersion(update.version, current) === 1;
}

/**
 * 版本号对比函数
 * @param v1 - 新版本号
 * @param v2 - 当前版本号
 * @returns 1: v1>v2, 0: 相等, -1: v1<v2
 */
function compareVersion(v1: string, v2: string): -1 | 0 | 1 {
  const normalize = (s: string) => s.trim().replace(/^v/i, "");
  const a = normalize(v1).split(".").map(Number);
  const b = normalize(v2).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}
