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
import { useMessageContextMenu } from "@/hooks/useMessageContextMenu";
import { storage } from "@/utils/Storage";
import { ElMessageBox } from "element-plus";
import { ref, watch } from "vue";

const props = defineProps({
  message: {
    type: Object,
    required: true,
    default: () => ({})
  }
});

const stickerUrl = ref("");
const loading = ref(false);

// 获取表情包信息
const fetchStickerInfo = async () => {
  const body = props.message.messageBody;
  // 优先使用 content 作为 id，其次尝试 id 字段
  const stickerId = body?.content || body?.id;

  if (!stickerId) {
    // 如果没有 ID，尝试使用 key 作为降级方案
    if (body?.key) {
      stickerUrl.value = body.key;
    }
    return;
  }

  try {
    loading.value = true;
    const res: any = await API.GetEmojiInfo(stickerId);
    if (res && res.url) {
      stickerUrl.value = res.url;
    } else if (body?.key) {
      stickerUrl.value = body.key;
    }
  } catch (error) {
    console.error("Failed to fetch sticker info:", error);
    // 出错时尝试使用 key
    if (body?.key) {
      stickerUrl.value = body.key;
    }
  } finally {
    loading.value = false;
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

// 判断是否在撤回时间内
function isWithinTwoMinutes(timestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= (Number(import.meta.env.VITE_MESSAGE_RECALL_TIME) || 120000);
}

// ===================== 右键菜单 =====================
const { menuConfig, setTarget } = useMessageContextMenu<any>({
  getOptions: (item) => {
    const target = item ?? props.message;
    const options = [{ label: "删除", value: "delete" }];
    if (isOwnerOfMessage(target) && isWithinTwoMinutes(target.messageTime)) {
      options.push({ label: "撤回", value: "recall" });
    }
    return options;
  },
  onAction: async (action, item) => {
    const target = item ?? props.message;
    try {
      if (action === "delete") {
        await ElMessageBox.confirm("确定删除这条消息吗?", "提示", {
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          type: "warning"
        });
        globalEventBus.emit(Events.MESSAGE_DELETE, target);
        return;
      }
      if (action === "recall") {
        globalEventBus.emit(Events.MESSAGE_RECALL, target);
      }
    } catch {
      // User cancelled or error
    }
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
