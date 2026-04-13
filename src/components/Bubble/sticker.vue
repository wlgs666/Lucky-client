<template>
  <div :id="`message-${message.messageId}`" v-context-menu="menuConfig"
    v-memo="[message.messageId, message.isOwner, stickerUrl]"
    :class="['bubble', message.type, { owner: message.isOwner }]" class="message-bubble image-bubble">
    <div class="image-wrapper">
      <img v-if="stickerUrl" :src="stickerUrl" alt="Sticker" class="img-bubble lazy-img" loading="lazy" />
      <div v-else class="loading-placeholder">
        <div class="spinner"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import API from "@/api";
import { Events } from "@/constants";
import { globalEventBus } from "@/hooks/useEventBus";
import { useLogger } from "@/hooks/useLogger";
import { useMessageContextMenu } from "@/hooks/useMessageContextMenu";
import { storage } from "@/utils/Storage";
import { ElMessageBox } from "element-plus";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

type MessageBody = {
  key?: string;
  id?: string;
  content?: string;
};

type MessageItem = {
  messageId: string;
  messageBody?: MessageBody;
  messageTime?: number;
  fromId?: string;
  isOwner?: boolean;
  type?: string;
};

const props = defineProps<{
  message: MessageItem;
}>();

const stickerUrl = ref("");
const { t } = useI18n();
const logger = useLogger();
const recallWindowMs = Number(import.meta.env.VITE_MESSAGE_RECALL_TIME) || 120000;
const promiseTry = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);
let lastRequestedStickerId = "";

const fetchStickerInfo = async () => {
  const body = props.message.messageBody;
  const stickerId = body?.content || body?.id;
  lastRequestedStickerId = stickerId || "";

  if (!stickerId) {
    stickerUrl.value = body?.key || "";
    return;
  }

  try {
    const res = await promiseTry(() => API.GetEmojiInfo(stickerId)) as { url?: string };
    if (lastRequestedStickerId !== stickerId) return;
    if (res && res.url) {
      stickerUrl.value = res.url;
    } else {
      stickerUrl.value = body?.key || "";
    }
  } catch (error) {
    if (lastRequestedStickerId !== stickerId) return;
    stickerUrl.value = body?.key || "";
    logger.warn("Failed to fetch sticker info", stickerId, error);
  }
};

// 监听消息变化重新获取
watch(
  () => props.message.messageId,
  () => {
    fetchStickerInfo();
  },
  { immediate: true }
);

// 判断当前用户是否为消息所有者
function isOwnerOfMessage(item: any) {
  if (!item) return false;
  if (typeof item.isOwner === "boolean") return item.isOwner;
  const currentUserId = storage.get("userId");
  return String(item.fromId) === String(currentUserId);
}

function isWithinTwoMinutes(timestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= recallWindowMs;
}

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

const actionHandlers: Record<string, (target: MessageItem) => void | Promise<void>> = {
  delete: (target) => handleDelete(target),
  recall: (target) => {
    globalEventBus.emit(Events.MESSAGE_RECALL, target);
  }
};

const { menuConfig, setTarget } = useMessageContextMenu<MessageItem>({
  getOptions: (item) => {
    const target = item ?? props.message;
    const options = [{ label: t("common.actions.delete"), value: "delete" }];
    if (isOwnerOfMessage(target) && !!target.messageTime && isWithinTwoMinutes(target.messageTime)) {
      options.push({ label: t("common.actions.recall"), value: "recall" });
    }
    return options;
  },
  onAction: async (action, item) => {
    const target = item ?? props.message;
    const handler = actionHandlers[action];
    if (!handler) return;
    await promiseTry(() => handler(target)).catch(() => undefined);
  },
  beforeShow: () => setTarget(props.message)
});
</script>

<style lang="scss" scoped>
.message-bubble.image-bubble {
  background-color: transparent !important;
  padding: 0;
  max-width: 150px;
  overflow: hidden;

  .image-wrapper {
    position: relative;
    display: flex;
    border-radius: 5px;
    overflow: hidden;
    transition: transform 0.2s ease;
    min-height: 40px;
    min-width: 40px;
    justify-content: center;
    align-items: center;

    img {
      display: block;
      max-width: 120px;
      max-height: 120px;
      object-fit: cover;
      cursor: pointer;
      // border-radius: 2px;
      /* box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); */
    }

    .loading-placeholder {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 50px;
      height: 50px;
    }
  }

  &.owner {
    .image-wrapper {
      justify-content: flex-end;
    }
  }
}

// 简单的加载动画
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
