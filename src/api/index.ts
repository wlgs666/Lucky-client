import { MessageCode } from "@/constants/MessageCode";
import HttpClient, { HttpParams } from "@/utils/Http.ts";
import Signer from "@/utils/Sign";
import { storage } from "@/utils/Storage";
import { ElMessage } from "element-plus";

// 创建实例，配置 baseURL、headers 与 timeout
const Http = HttpClient.create({
  baseURL: import.meta.env.VITE_API_SERVER,
  headers: { "Content-Type": "application/json" },
  timeout: 20000,
});

// 添加请求拦截器（注入 Token 和签名）
Http.interceptors.request.use(async (config: HttpParams) => {
  // 获取 Token（自动处理过期检测）
  const accessToken = storage.get("token");
  const lang = storage.get("lang")

  // 如果 Token 为空，尝试获取原始 Token（可能需要刷新）
  // if (!accessToken) {
  //   const needsRefresh = await tokenManager.needsRefresh();

  //   if (needsRefresh) {
  //     // 处理 Token 刷新（防止并发）
  //     if (!isRefreshing) {
  //       isRefreshing = true;

  //       const newToken = await doRefreshToken();
  //       isRefreshing = false;

  //       if (newToken) {
  //         onTokenRefreshed(newToken);
  //         accessToken = newToken;
  //       }
  //     } else {
  //       // 等待刷新完成
  //       accessToken = await new Promise<string>((resolve) => {
  //         subscribeTokenRefresh((token: string) => {
  //           resolve(token);
  //         });
  //       });
  //     }
  //   }
  // }

  // 注入 Token
  if (accessToken) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${accessToken}`,
    };
  }

  // 语言
  if (lang) {
    config.headers = {
      ...config.headers,
      "Accept-Language": lang,
    };
  }

  // 接口签名（基于 data 生成 query params）
  const signedParams = Signer.buildSignedParams(config.data || {}, "yourAppId", "secretFor_yourAppId");
  config.params = {
    ...config.params,
    ...signedParams,
  };

  return config;
});

type Response = {
  code: number;
  message: string;
  timestamp: number;
  data: any;
};

// 添加响应拦截器（全局错误处理）
Http.interceptors.response.use(async (data: Response) => {
  const code = data.code;
  const msg = data.message;
  const rejectWithError = () => Promise.reject(new Error(msg));

  // 1. 成功
  if (code === MessageCode.SUCCESS) {
    return data.data ?? data;
  }

  // 2. 权限/鉴权相关
  const authErrorHandlers: Partial<Record<number, () => Promise<never>>> = {
    [MessageCode.UNAUTHORIZED]: () => {
      ElMessage.warning("登录已过期，请重新登录");
      return rejectWithError();
    },
    [MessageCode.FORBIDDEN]: () => {
      ElMessage.error("无权限访问该资源");
      return rejectWithError();
    },
    [MessageCode.NOT_FOUND]: () => {
      ElMessage.error("请求的资源不存在");
      return rejectWithError();
    }
  };
  const authHandler = authErrorHandlers[code];
  if (authHandler) {
    return authHandler();
  }

  // 3. 服务端错误
  if (code === MessageCode.INTERNAL_SERVER_ERROR) {
    ElMessage.error("服务器内部错误，请稍后重试");
    return Promise.reject(new Error(msg));
  }
  if (code === MessageCode.SERVICE_UNAVAILABLE) {
    ElMessage.error("服务不可用，可能正在维护中");
    return Promise.reject(new Error(msg));
  }
  if (code === MessageCode.SERVICE_EXCEPTION) {
    ElMessage.error("服务异常，请联系管理员");
    return Promise.reject(new Error(msg));
  }
  if (code === MessageCode.REQUEST_DATA_TOO_LARGE) {
    ElMessage.warning("请求数据过大，已被拒绝处理");
    return Promise.reject(new Error(msg));
  }

  const businessWarningMessages: Partial<Record<number, string>> = {
    [MessageCode.INVALID_CREDENTIALS]: "用户名或密码错误",
    [MessageCode.ACCOUNT_DISABLED]: "账户已被禁用",
    [MessageCode.ACCOUNT_LOCKED]: "账户已被锁定",
    [MessageCode.ACCOUNT_EXPIRED]: "账户已过期",
    [MessageCode.CREDENTIALS_EXPIRED]: "登录凭证已过期",
    [MessageCode.AUTHENTICATION_FAILED]: "身份验证失败,请检查登录信息是否正确",
    [MessageCode.CAPTCHA_ERROR]: "验证码错误",
    [MessageCode.TOKEN_IS_NULL]: "Token 为空",
    [MessageCode.TOKEN_IS_INVALID]: "Token 无效",
    [MessageCode.EXCESSIVE_LOGIN_FAILURES]: "登录失败次数过多",
    [MessageCode.ACCOUNT_NOT_FOUND]: "账户未找到",
    [MessageCode.SMS_ERROR]: "短信发送失败",
    [MessageCode.ACCOUNT_ALREADY_EXIST]: "账户已存在",
    [MessageCode.QRCODE_IS_INVALID]: "二维码无效或已过期",
    [MessageCode.UNSUPPORTED_AUTHENTICATION_TYPE]: "不支持的认证方式",
    [MessageCode.VALIDATION_INCOMPLETE]: "验证信息不完整"
  };
  if (code === MessageCode.USER_OFFLINE) {
    return data.data;
  }
  if (code === MessageCode.NO_PERMISSION) {
    ElMessage.error("操作失败：没有权限");
  } else {
    const warningMessage = businessWarningMessages[code];
    if (warningMessage) {
      ElMessage.warning(warningMessage);
    }
  }

  // 5. 通用失败
  if (code === MessageCode.FAIL || code < 0) {
    ElMessage.warning(msg || "请求失败，请稍后重试");
  }

  // 默认返回 null 或抛错
  return null;
});

export default {

  /** ================================================== 登录模块 =============================================================== */

  /** 登录 */
  Login: (data: any) => Http.post("/auth/api/v1/auth/login", data),

  /** 退出登录 */
  LoginOut: (data: any) => Http.post("/auth/api/v1/auth/logout", data),

  /** 刷新token */
  RefreshToken: (token: string) => Http.get("/auth/api/v1/auth/refresh/token", { headers: { "X-Refresh-Token": token } }),

  /** 短信发送 */
  Sms: (params: any) => Http.get("/auth/api/v1/auth/sms", { params }),

  /** 获取二维码 */
  GetQRCode: (params: any) => Http.get("/auth/api/v1/auth/qrcode", { params }),

  /** 扫码登录 */
  ScanQRCode: (data: any) => Http.post("/auth/api/v1/auth/qrcode/scan", data),

  /** 检查二维码状态 */
  CheckQRCodeStatus: (params: any) => Http.get("/auth/api/v1/auth/qrcode/status", { params }),

  /** 获取公钥 */
  GetPublicKey: () => Http.get("/auth/api/v1/auth/publickey"),

  /** 是否在线 */
  GetOnline: (params: any) => Http.get("/auth/api/v1/auth/online", { params }),

  /** 获取个人信息 */
  GetUserInfo: (params: any) => Http.get("/auth/api/v1/auth/info", { params }),





  /** 发送单聊消息 */
  SendSingleMessage: (data: any) => Http.post("/message/api/v1/message/single", data),

  /** 发送群聊消息 */
  SendGroupMessage: (data: any) => Http.post("/message/api/v1/message/group", data),

  /** 撤回消息 */
  RecallMessage: (data: any) => Http.post("/message/api/v1/message/recall", data),

  /** 获取私聊消息列表 */
  GetSingleMessageList: (data: any) => Http.post("/message/api/v1/message/single/list", data),

  /** 获取群聊消息列表 */
  GetGroupMessageList: (data: any) => Http.post("/message/api/v1/message/group/list", data),

  /** 检查单聊消息 */
  SingleCheck: (data: any) => Http.post("/message/api/v1/message/singleCheck", data),

  /** 发送视频消息 */
  SendCallMessage: (data: any) => Http.post("/message/api/v1/message/media/video", data),



  /** ================================================== 业务模块 =============================================================== */


  /** 获取群成员 */
  GetGroupMember: (data: any) => Http.post("/business/api/v1/group/member", data),

  /** 更新群聊信息 */
  updateGroupInfo: (data: any) => Http.post("/business/api/v1/group/update", data),

  /** 更新修改好友备注名 **/
  updateFriendRemark: (data: any) => Http.post("/business/api/v1/relationship/updateFriendRemark", data),

  /** 同意或拒绝群聊邀请 */
  ApproveGroup: (data: any) => Http.post("/business/api/v1/group/approve", data),

  /** 退出群聊 */
  QuitGroups: (data: any) => Http.post("/business/api/v1/group/quit", data),

  /** 邀请群成员 */
  InviteGroupMember: (data: any) => Http.post("/business/api/v1/group/invite", data),

  /** 获取群信息 */
  GetGroupInfo: (data: any) => Http.post("/business/api/v1/group/info", data),

  /** 踢出群成员 */
  KickGroupMember: (data: any) => Http.post("/business/api/v1/group/member/kick", data),

  /** 设置/取消管理员 */
  SetGroupAdmin: (data: any) => Http.post("/business/api/v1/group/member/setAdmin", data),

  /** 移交群主 */
  TransferGroupOwner: (data: any) => Http.post("/business/api/v1/group/transferOwner", data),

  /** 设置群加入方式 */
  SetGroupJoinMode: (data: any) => Http.post("/business/api/v1/group/setJoinMode", data),

  /** 禁言/取消禁言成员 */
  MuteGroupMember: (data: any) => Http.post("/business/api/v1/group/member/mute", data),

  /** 更新群成员信息（群昵称/备注） */
  UpdateGroupMember: (data: any) => Http.post("/business/api/v1/group/member/update", data),

  /** 全员禁言/取消全员禁言 */
  MuteAllGroupMembers: (data: any) => Http.post("/business/api/v1/group/muteAll", data),

  /** 解散群组 */
  DismissGroup: (data: any) => Http.post("/business/api/v1/group/dismiss", data),

  /** 设置群公告 */
  SetGroupAnnouncement: (data: any) => Http.post("/business/api/v1/group/announcement", data),

  /** 会话列表 */
  GetChatList: (data: any) => Http.post("/business/api/v1/chat/list", data),

  /** 获取会话 */
  GetChat: (params: any) => Http.get("/business/api/v1/chat/one", { params }),

  /** 已读 */
  ReadChat: (data: any) => Http.post("/business/api/v1/chat/read", data),

  /** 创建会话 */
  CreateChat: (data: any) => Http.post("/business/api/v1/chat/create", data),

  /** 获取用户信息 */
  UpdateUserInfo: (data: any) => Http.post("/business/api/v1/user/update", data),

  /** 获取好友列表 */
  GetContacts: (params: any) => Http.get("/business/api/v1/relationship/contacts/list", { params }),

  /** 获取群列表 */
  GetGroups: (params: any) => Http.get("/business/api/v1/relationship/groups/list", { params }),

  /** 获取好友添加请求列表 */
  GetNewFriends: (params: any) => Http.get("/business/api/v1/relationship/newFriends/list", { params }),

  /** 获取好友信息 */
  GetContactInfo: (data: any) => Http.post("/business/api/v1/relationship/getFriendInfo", data),

  /** 搜索好友信息 */
  SearchContactInfoList: (data: any) => Http.post("/business/api/v1/relationship/search/getFriendInfoList", data),

  /** 请求添加好友 */
  RequestContact: (data: any) => Http.post("/business/api/v1/relationship/requestContact", data),

  /** 同意或拒绝好友请求 */
  ApproveContact: (data: any) => Http.post("/business/api/v1/relationship/approveContact", data),

  /** 删除好友 */
  DeleteContact: (data: any) => Http.post("/business/api/v1/relationship/deleteFriendById", data),

  /** 获取用户表情包 */
  GetUserEmojis: (params: any) => Http.get("/business/api/v1/sticker/list", { params }),

  /** 获取表情包详情 */
  GetEmojiPackInfo: (id: string) => Http.get(`/business/api/v1/sticker/pack/${id}`),

  /** 获取表情详情 */
  GetEmojiInfo: (id: string) => Http.get(`/business/api/v1/sticker/${id}`),


  /** ================================================== 平台模块 =============================================================== */


  /** ================================================== 文件管理模块 =============================================================== */

  /** 文件上传 */
  UploadFile: (data: any) => Http.upload("/oss/api/v1/file/upload", data),

  /** 文件下载 */
  DownloadFile: (params: any) => Http.get("/oss/api/v1/file/download", { params }),

  /** 图片上传 */
  uploadImage: (data: FormData) => Http.upload("/oss/api/v1/media/image/upload", data),

  /** 头像上传 */
  uploadAvatar: (data: FormData) => Http.upload("/oss/api/v1/media/avatar/upload", data),

  /** 获取文件url */
  getFilePresignedPutUrl: (params: any) => Http.get("/oss/api/v1/file/getPresignedPutUrl", { params }),

  /** 获取媒体文件url */
  getImagePresignedPutUrl: (params: any) => Http.get("/oss/api/v1/media/image-url", { params }),

  /** 获取媒体文件url */
  getAudioPresignedPutUrl: (params: any) => Http.get("/oss/api/v1/media/audio-url", { params }),

  /** ================================================== 日志模块 =============================================================== */

  /** 异常上报 */
  ExceptionReport: (params: any) => Http.get("/log/api/v1/tauri/exception/report", { params })
};
