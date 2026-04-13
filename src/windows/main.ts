import { StoresEnum } from "@/constants/index";
import { closeWindow, getWindow, showAndFocus } from "@/windows/utils";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, Window } from "@tauri-apps/api/window";

const MAIN_WINDOW_LOGIN = {
  title: "Login",
  url: "/login",
  width: 280,
  height: 400,
  resizable: false,
};

const MAIN_WINDOW_MESSAGE = {
  title: "Lucky",
  url: "/message",
  width: 950,
  height: 650,
  resizable: true,
};

type MainWindowMode = "login" | "message";

const getMainWindow = async (): Promise<Window | null> => getWindow(StoresEnum.MAIN);

const getModeConfig = (mode: MainWindowMode) => {
  return mode === "login" ? MAIN_WINDOW_LOGIN : MAIN_WINDOW_MESSAGE;
};

const waitForWebviewReady = async (webview: WebviewWindow) => {
  await new Promise<void>((resolve, reject) => {
    webview.once("tauri://webview-created", () => resolve());
    webview.once("tauri://error", error => reject(error));
  });
};

const applyMode = async (mainWindow: Window, mode: MainWindowMode) => {
  const config = getModeConfig(mode);
  await mainWindow.setTitle(config.title);
  await mainWindow.setResizable(config.resizable);
  await mainWindow.setMinSize(new LogicalSize(config.width, config.height));
  await mainWindow.setSize(new LogicalSize(config.width, config.height));
  await mainWindow.center();
  await mainWindow.show();
  await mainWindow.unminimize();
  await mainWindow.setFocus();
};

export async function CreateMainWindow(mode: MainWindowMode = "message") {
  const existingWindow = await getMainWindow();
  if (existingWindow) {
    await applyMode(existingWindow, mode);
    return;
  }

  const config = getModeConfig(mode);

  const webview = new WebviewWindow(StoresEnum.MAIN, {
    title: config.title,
    url: config.url,
    width: config.width,
    height: config.height,
    minWidth: config.width,
    minHeight: config.height,
    center: true,
    resizable: config.resizable,
    decorations: false,
    alwaysOnTop: false,
    visible: true,
    transparent: true,
    shadow: false
  });

  try {
    await waitForWebviewReady(webview);
    await webview.show();
    await webview.setFocus();
  } catch (error) {
    console.warn("CreateMainWindow failed", error);
  }
}

export const SwitchMainWindowToLogin = async () => {
  const mainWindow = await getMainWindow();
  if (!mainWindow) return;
  await applyMode(mainWindow, "login");
};

export const SwitchMainWindowToMessage = async () => {
  const mainWindow = await getMainWindow();
  if (!mainWindow) return;
  await applyMode(mainWindow, "message");
};

export const CloseMainWindow = async () => {
  await closeWindow(StoresEnum.MAIN);
};

export const ShowMainWindow = async () => {
  await showAndFocus(StoresEnum.MAIN);
};

export const antiScreenshot = async () => {
  const mainWindow = await getMainWindow();
  if (mainWindow) {
    try {
      await mainWindow.setContentProtected(true);
    } catch (e) {
      console.warn("setContentProtected 可能在某些平台不可用", e);
    }
  }
};

export const appIsMinimizedOrHidden = async (): Promise<boolean> => {
  try {
    const mainWindow = await getMainWindow();
    if (!mainWindow) return false;
    const isMinimized = await mainWindow.isMinimized();
    const isVisible = await mainWindow.isVisible();
    return isMinimized || !isVisible;
  } catch (error) {
    console.error("Error checking window minimized or hidden status:", error);
    return false;
  }
};

export default { CreateMainWindow, CloseMainWindow };
