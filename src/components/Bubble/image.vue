<template>
  <div :id="`message-${message.messageId}`" v-context-menu="menuConfig"
    v-memo="[message.messageId, message.isOwner, imageUrl]" :class="['image-bubble', { owner: message.isOwner }]"
    class="message-bubble image-bubble">
    <div class="image-wrapper" @click="handlePreview">
      <img v-if="imageUrl" :src="imageUrl" alt="Image" class="img-bubble lazy-img" loading="lazy"
        @error="handleImageError" />
      <div v-else class="loading-placeholder">
        <div class="spinner"></div>
      </div>
    </div>
    <ReplyQuote v-if="replyInfo" :replyMessage="replyInfo" :senderName="replySenderName" />
  </div>
</template>

<script lang="ts" setup>
import API from "@/api";
import { CacheEnum, Events, MessageContentType } from "@/constants";
import { globalEventBus } from "@/hooks/useEventBus";
import { useFile } from "@/hooks/useFile";
import { useLogger } from "@/hooks/useLogger";
import { useMessageContextMenu } from "@/hooks/useMessageContextMenu";
import { ReplyMessageInfo } from "@/models";
import { useChatStore } from "@/store/modules/chat";
import ClipboardManager from "@/utils/Clipboard";
import { getPath } from "@/utils/Image";
import { storage } from "@/utils/Storage";
import { ShowPreviewWindow } from "@/windows/preview";
import { readFile } from "@tauri-apps/plugin-fs";
import { ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ReplyQuote from "./ReplyQuote.vue";

type MessageItem = {
  messageId: string;
  messageBody?: { key?: string; name?: string; replyMessage?: ReplyMessageInfo };
  messageTime?: number;
  fromId?: string;
  isOwner?: boolean;
  name?: string;
};

const props = defineProps<{
  message: MessageItem;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const replyInfo = computed(() => props.message.messageBody?.replyMessage);
const replySenderName = computed(() => {
  const replyFromId = replyInfo.value?.fromId;
  if (!replyFromId) return "";

  const currentUserId = storage.get("userId");
  if (String(replyFromId) === String(currentUserId)) {
    return t("components.message.me");
  }

  const membersMap = chatStore.currentChatGroupMemberMap;
  const member = membersMap?.[String(replyFromId)];
  return member?.name || replyFromId;
});

const imageUrl = ref("");
const previewUrl = ref("");
const { downloadFile } = useFile();
const logger = useLogger();
const recallWindowMs = Number(import.meta.env.VITE_MESSAGE_RECALL_TIME) || 120000;
let lastRequestedKey = "";

const handlePreview = () => {
  const url = previewUrl.value || imageUrl.value;
  if (url) ShowPreviewWindow("", url, "image");
};

const handleImageError = () => {
  if (previewUrl.value && imageUrl.value !== previewUrl.value) {
    imageUrl.value = previewUrl.value;
  }
};

const isOwner = (item: MessageItem) =>
  typeof item.isOwner === "boolean" ? item.isOwner : String(item.fromId) === String(storage.get("userId"));

const canRecall = (item: MessageItem) => !!item.messageTime && Date.now() - item.messageTime <= recallWindowMs;
const promiseTry = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);

const handleDelete = async (target: MessageItem) => {
  await ElMessageBox.confirm(
    t("components.dialog.deleteMessage.confirm"),
    t("components.dialog.title.warning"),
    {
      distinguishCancelAndClose: true,
      confirmButtonText: t("components.dialog.buttons.confirm"),
      cancelButtonText: t("components.dialog.buttons.cancel"),
      type: "warning"
    }
  );
  globalEventBus.emit(Events.MESSAGE_DELETE, target);
};

const handleSaveAs = async (target: MessageItem) => {
  await downloadFile(target.messageBody?.name || `image_${Date.now()}.png`, target.messageBody?.key || "");
};

const handleCopy = async (target: MessageItem) => {
  await ClipboardManager.clear();
  const key = await getPath(target.messageBody?.key || "", CacheEnum.IMAGE_CACHE);
  const imgBuf = await readFile(key);
  await ClipboardManager.writeImage(imgBuf);
  logger.prettySuccess("Image copied", target.messageBody?.key);
};

const actionHandlers: Record<string, (target: MessageItem) => void | Promise<void>> = {
  reply: (target) => handleReply(target),
  copy: (target) => handleCopy(target),
  saveAs: (target) => handleSaveAs(target),
  delete: (target) => handleDelete(target),
  recall: (target) => {
    globalEventBus.emit(Events.MESSAGE_RECALL, target);
  }
};

const { menuConfig, setTarget } = useMessageContextMenu<typeof props.message>({
  getOptions: (item) => {
    const target = item ?? props.message;
    const opts = [
      { label: t("components.bubble.reply.action"), value: "reply" },
      { label: t("common.actions.copy"), value: "copy" },
      { label: t("common.actions.saveAs"), value: "saveAs" },
      { label: t("common.actions.delete"), value: "delete" }
    ];
    if (isOwner(target) && canRecall(target)) {
      opts.splice(3, 0, { label: t("common.actions.recall"), value: "recall" });
    }
    return opts;
  },
  onAction: async (action, item) => {
    const target = item ?? props.message;
    const handler = actionHandlers[action];
    if (!handler) return;
    await promiseTry(() => handler(target)).catch(() => undefined);
  },
  beforeShow: () => setTarget(props.message)
});

function handleReply(msg: typeof props.message): void {
  globalEventBus.emit(Events.MESSAGE_REPLY, {
    messageId: msg.messageId,
    fromId: msg.fromId,
    previewText: t("components.bubble.reply.image"),
    messageContentType: MessageContentType.IMAGE.code,
    senderName: msg.name || msg.fromId
  });
}

const fetchImageInfo = async () => {
  const { key } = props.message.messageBody || {};
  lastRequestedKey = key || "";
  if (!key) {
    imageUrl.value = "";
    previewUrl.value = "";
    return;
  }
  try {
    const res = await promiseTry(() => API.getImagePresignedPutUrl({ identifier: key })) as {
      path?: string;
      thumbPath?: string;
    };
    if (lastRequestedKey !== key) return;
    previewUrl.value = res.path || "";
    imageUrl.value = res.thumbPath || res.path || "";
  } catch (error) {
    if (lastRequestedKey !== key) return;
    imageUrl.value = "";
    previewUrl.value = "";
    logger.warn("Failed to fetch image url", key, error);
  }
};

watch(
  () => props.message.messageBody?.key,
  () => {
    fetchImageInfo();
  },
  { immediate: true }
);

</script>

<style lang="scss" scoped>
.message-bubble.image-bubble {
  background-color: transparent !important;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin: 4px 0;
  max-width: 300px;

  :deep(.reply-quote) {
    max-width: 280px;
  }

  .image-wrapper {
    position: relative;
    display: flex;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    min-height: 40px;
    min-width: 40px;
    align-items: center;
    justify-content: center;
  }

  .img-bubble {
    display: block;
    max-width: 280px;
    max-height: 300px;
    object-fit: cover;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s ease;
  }

  .image-wrapper:hover .img-bubble {
    transform: scale(1.02);
  }

  .loading-placeholder {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 50px;
    height: 50px;
  }

  &.owner .image-wrapper {
    justify-content: flex-end;
  }
}

.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(152, 128, 255, 0.2);
  border-top-color: #9880ff;
  animation: spinner-rotate 0.8s linear infinite;
}

@keyframes spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
