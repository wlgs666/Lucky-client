<template>
  <div :id="`message-${message.messageId}`" v-context-menu="menuConfig"
    v-memo="[message.messageId, message.isOwner, audioSrc, isPlaying, displayDuration, replyInfo?.messageId]"
    :class="['bubble', message.type, { owner: message.isOwner }]" class="message-bubble audio-message-bubble">
    <div class="audio-wrapper" :style="bubbleStyle" @click="togglePlay">
      <button class="audio-toggle" type="button" :aria-label="isPlaying ? 'pause audio' : 'play audio'">
        <span v-if="!isPlaying" class="play-triangle"></span>
        <span v-else class="pause-bars">
          <span></span>
          <span></span>
        </span>
      </button>
      <div class="audio-wave" :class="{ playing: isPlaying }">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="audio-duration">{{ durationText }}</div>
      <span v-if="!message.isOwner && !hasPlayed" class="audio-unread-dot"></span>
      <audio ref="audioRef" :src="audioSrc" preload="metadata" @loadedmetadata="handleLoadedMetadata"
        @ended="handleEnded"></audio>
    </div>
    <ReplyQuote v-if="replyInfo" :replyMessage="replyInfo" :senderName="replySenderName" />
  </div>
</template>

<script lang="ts" setup>
import API from "@/api";
import { Events, MessageContentType } from "@/constants";
import { globalEventBus } from "@/hooks/useEventBus";
import { useFile } from "@/hooks/useFile";
import { useLogger } from "@/hooks/useLogger";
import { useMessageContextMenu } from "@/hooks/useMessageContextMenu";
import { ReplyMessageInfo } from "@/models";
import { useChatStore } from "@/store/modules/chat";
import { storage } from "@/utils/Storage";
import { ElMessageBox } from "element-plus";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ReplyQuote from "./ReplyQuote.vue";

type MessageBody = {
  key?: string;
  name?: string;
  duration?: number;
  size?: number;
  replyMessage?: ReplyMessageInfo;
};

type MessageItem = {
  messageId: string;
  messageBody?: MessageBody | string;
  messageTime?: number;
  fromId?: string;
  isOwner?: boolean;
  name?: string;
  type?: string;
};

const props = defineProps<{
  message: MessageItem;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const { downloadFile } = useFile();
const logger = useLogger();

const recallWindowMs = Number(import.meta.env.VITE_MESSAGE_RECALL_TIME) || 120000;
const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const hasPlayed = ref(false);
const displayDuration = ref(0);
const audioUrl = ref("");
const syncPlayEvent = "lucky-audio-bubble-play";
let lastRequestedKey = "";

const parseBody = (raw: MessageItem["messageBody"]): MessageBody => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed as MessageBody : {};
    } catch {
      return {};
    }
  }
  return raw;
};

const messageBody = computed(() => parseBody(props.message.messageBody));
const audioSrc = computed(() => audioUrl.value);
const replyInfo = computed(() => messageBody.value.replyMessage);
const replySenderName = computed(() => {
  const replyFromId = replyInfo.value?.fromId;
  if (!replyFromId) return "";

  const currentUserId = storage.get("userId");
  if (String(replyFromId) === String(currentUserId)) return t("components.message.me");

  const membersMap = chatStore.currentChatGroupMemberMap;
  const member = membersMap?.[String(replyFromId)];
  return member?.name || replyFromId;
});

const normalizeDuration = (value?: number) => {
  if (!value || Number.isNaN(value)) return 0;
  if (value > 1000) return Math.round(value / 1000);
  return Math.round(value);
};

const durationText = computed(() => {
  const total = Math.max(0, Math.floor(displayDuration.value));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
});

const bubbleStyle = computed(() => {
  const duration = Math.min(60, Math.max(1, displayDuration.value || 1));
  const width = 116 + (duration / 60) * 124;
  return { width: `${Math.round(width)}px` };
});

const isOwner = (item: MessageItem) =>
  typeof item.isOwner === "boolean" ? item.isOwner : String(item.fromId) === String(storage.get("userId"));

const canRecall = (item: MessageItem) => !!item.messageTime && Date.now() - item.messageTime <= recallWindowMs;
const promiseTry = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);

const resolveAudioPath = (res: unknown): string => {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res === "object") {
    const data = res as { path?: string; url?: string; key?: string };
    return data.path || data.url || data.key || "";
  }
  return "";
};

const fetchAudioInfo = async () => {
  const key = messageBody.value.key || "";
  lastRequestedKey = key;
  if (!key) {
    audioUrl.value = "";
    return;
  }

  try {
    const res = await promiseTry(() => API.getAudioPresignedPutUrl({ identifier: key })) as {
      path?: string;
      url?: string;
      key?: string;
    };
    if (lastRequestedKey !== key) return;
    audioUrl.value = resolveAudioPath(res);
  } catch (error) {
    if (lastRequestedKey !== key) return;
    audioUrl.value = /^https?:\/\//i.test(key) ? key : "";
    logger.warn("Failed to fetch audio url", key, error);
  }
};

const handleLoadedMetadata = () => {
  if (!audioRef.value) return;
  const duration = audioRef.value.duration;
  if (Number.isFinite(duration) && duration > 0) {
    displayDuration.value = Math.round(duration);
  }
};

const handleEnded = () => {
  isPlaying.value = false;
};

const pauseAudio = () => {
  if (!audioRef.value) return;
  audioRef.value.pause();
  isPlaying.value = false;
};

const togglePlay = async () => {
  if (!audioRef.value || !audioSrc.value) return;
  if (isPlaying.value) {
    pauseAudio();
    return;
  }
  window.dispatchEvent(new CustomEvent(syncPlayEvent, { detail: { messageId: props.message.messageId } }));
  try {
    await audioRef.value.play();
    isPlaying.value = true;
    hasPlayed.value = true;
  } catch {
    isPlaying.value = false;
  }
};

const onOtherAudioPlay = (event: Event) => {
  const customEvent = event as CustomEvent<{ messageId?: string }>;
  const playingMessageId = customEvent.detail?.messageId;
  if (playingMessageId && String(playingMessageId) !== String(props.message.messageId)) {
    pauseAudio();
  }
};

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
  const body = parseBody(target.messageBody);
  await downloadFile(body.name || `audio_${Date.now()}.mp3`, body.key || "");
};

function handleReply(msg: MessageItem): void {
  globalEventBus.emit(Events.MESSAGE_REPLY, {
    messageId: msg.messageId,
    fromId: msg.fromId,
    previewText: t("components.bubble.reply.audio"),
    messageContentType: MessageContentType.AUDIO.code,
    senderName: msg.name || msg.fromId
  });
}

const actionHandlers: Record<string, (target: MessageItem) => void | Promise<void>> = {
  reply: (target) => handleReply(target),
  saveAs: (target) => handleSaveAs(target),
  delete: (target) => handleDelete(target),
  recall: (target) => {
    globalEventBus.emit(Events.MESSAGE_RECALL, target);
  }
};

const { menuConfig, setTarget } = useMessageContextMenu<MessageItem>({
  getOptions: (item) => {
    const target = item ?? props.message;
    const options = [
      { label: t("components.bubble.reply.action"), value: "reply" },
      { label: t("common.actions.saveAs"), value: "saveAs" },
      { label: t("common.actions.delete"), value: "delete" }
    ];
    if (isOwner(target) && canRecall(target)) {
      options.splice(2, 0, { label: t("common.actions.recall"), value: "recall" });
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

watch(
  () => props.message.messageBody,
  () => {
    displayDuration.value = normalizeDuration(messageBody.value.duration);
    hasPlayed.value = false;
    pauseAudio();
  },
  { immediate: true }
);

watch(
  () => messageBody.value.key,
  () => {
    fetchAudioInfo();
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener(syncPlayEvent, onOtherAudioPlay as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener(syncPlayEvent, onOtherAudioPlay as EventListener);
  pauseAudio();
});
</script>

<style lang="scss" scoped>
.message-bubble.audio-message-bubble {
  background-color: transparent !important;
  padding: 0;
  display: flex;
  flex-direction: column;
  max-width: 260px;
  gap: 4px;

  :deep(.reply-quote) {
    max-width: 240px;
  }

  .audio-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 8px 12px;
    border-radius: 20px;
    background: #f3f5f7;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.2s ease, transform 0.2s ease;

    &:hover {
      background: #ebeff3;
    }

    &:active {
      transform: scale(0.99);
    }
  }

  .audio-toggle {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.08);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .play-triangle {
    width: 0;
    height: 0;
    margin-left: 2px;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-left: 9px solid #5f6b7a;
  }

  .pause-bars {
    display: inline-flex;
    gap: 3px;

    span {
      width: 3px;
      height: 10px;
      border-radius: 2px;
      background: #5f6b7a;
    }
  }

  .audio-wave {
    flex: 1;
    min-width: 30px;
    display: inline-flex;
    align-items: center;
    gap: 3px;

    span {
      width: 3px;
      height: 6px;
      border-radius: 2px;
      background: #9ca7b5;
      transition: height 0.2s ease;
    }

    &.playing span {
      animation: wave-bounce 0.9s ease-in-out infinite;
    }

    &.playing span:nth-child(2) {
      animation-delay: 0.15s;
    }

    &.playing span:nth-child(3) {
      animation-delay: 0.3s;
    }
  }

  .audio-duration {
    min-width: 38px;
    text-align: right;
    font-size: 12px;
    font-weight: 500;
    color: #6d7784;
  }

  .audio-unread-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff4d4f;
  }

  &.owner {
    .audio-wrapper {
      margin-left: auto;
      background: #dcf8c6;
      flex-direction: row-reverse;
    }

    .audio-wrapper:hover {
      background: #d3f3ba;
    }

    .audio-duration {
      text-align: left;
    }
  }
}

@keyframes wave-bounce {

  0%,
  100% {
    height: 6px;
    opacity: 0.7;
  }

  50% {
    height: 14px;
    opacity: 1;
  }
}
</style>
