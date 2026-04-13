<template>
  <div aria-label="消息记录" class="message-records" role="region">
    <DynamicScroller v-if="validMessages.length > 0" ref="scrollerRef" :items="validMessages" :min-item-size="64"
      :buffer="200" class="message-records__list" key-field="messageId" @scroll="handleScroll">
      <template #default="{ item, index, active }">
        <DynamicScrollerItem :active="active" :index="index" :item="item" :size-dependencies="[item.messageBody]">
          <Message :message="item" :id="`message-${item.messageId}`"
            :more="isFirstItem(index) && active && hasMoreMessages" :time="shouldDisplayTime(index)"
            @handleMoreMessage="loadMoreMessages" />
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>

    <!-- 空消息列表 -->
    <div v-else class="message-records__empty" />

    <el-drawer v-model="chatStore.isShowDetail" :destroy-on-close="true" :title="chatStore.getCurrentName" size="32%"
      style="position: absolute" @close="chatStore.handleChatDetail">
      <component :is="detailComponent" @handleClearGroupMessage="handleClearMessage"
        @handleClearFriendMessage="handleClearMessage" @handleQuitGroup="handleDelete"
        @handleDeleteContact="handleDelete" />
    </el-drawer>
  </div>
</template>

<script lang="ts" setup>
import GroupDetail from "@/components/ChatDetail/group.vue";
import SingleDetail from "@/components/ChatDetail/single.vue";
import { MessageType } from "@/constants";
import type Chats from "@/database/entity/Chats";
import { useChatStore } from "@/store/modules/chat";
import { useFriendsStore } from "@/store/modules/friends";
import { useMessageStore } from "@/store/modules/message";
import { useDebounceFn } from "@vueuse/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { DynamicScroller, DynamicScrollerItem } from "vue-virtual-scroller";

// ========================= 类型定义 =========================
interface MessageItem {
  messageId?: string;
  messageTime: number;
  isOwner?: boolean;
  [key: string]: unknown;
}

type ValidMessageItem = MessageItem & { messageId: string };
type MessageSnapshot = { firstId: string | null; lastId: string | null; length: number };

interface ScrollerInstance {
  $el: HTMLElement;
  update?: () => void;
  scrollToItem?: (index: number) => void;
  scrollToBottom?: (options?: { behavior: ScrollBehavior }) => void;
}

const props = defineProps<{
  data: MessageItem[];
  count: number;
  chat: Chats;
}>();

const TIME_GAP_THRESHOLD = 5 * 60 * 1000; // 5分钟
const SCROLL_BOTTOM_THRESHOLD = 10;

const chatStore = useChatStore();
const messageStore = useMessageStore();
const friendStore = useFriendsStore();

const scrollerRef = ref<ScrollerInstance | null>(null);
const loadMoreRequestId = ref(0);
const autoScrollState = ref({
  rafId: null as number | null,
  behavior: "smooth" as ScrollBehavior,
});

// 滚动状态
const scrollState = ref({
  previousHeight: 0,
  previousTop: 0,
  isLoadingMore: false,
  isAtBottom: true,
});

// 过滤有效消息（确保每条消息都有有效的 messageId）
const validMessages = computed<ValidMessageItem[]>(() => {
  if (!Array.isArray(props.data)) return [];

  const seen = new Set<string>();
  const result: ValidMessageItem[] = [];
  props.data.forEach((item) => {
    // 确保有有效的 messageId
    if (!item?.messageId) return;

    const id = String(item.messageId);

    // 去重
    if (seen.has(id)) return;
    seen.add(id);
    result.push({ ...item, messageId: id });
  });
  return result;
});

// 是否是群聊
const isGroupMessage = computed(
  () => chatStore.getCurrentType === MessageType.GROUP_MESSAGE.code
);

// 详情组件
const detailComponent = computed(() =>
  isGroupMessage.value ? GroupDetail : SingleDetail
);

// 是否有更多消息
const hasMoreMessages = computed(() => props.count > 0);
const currentChatId = computed(() => String(props.chat?.chatId ?? ""));
const messageSignature = computed(() => {
  const messages = validMessages.value;
  const firstId = messages[0]?.messageId ?? "";
  const lastId = messages[messages.length - 1]?.messageId ?? "";
  return `${messages.length}:${firstId}:${lastId}`;
});

// 获取滚动元素
const getScrollerEl = (): HTMLElement | null => scrollerRef.value?.$el ?? null;

// 更新滚动元素
const updateScroller = () => {
  scrollerRef.value?.update?.();
};

// 滚动到元素底部
const scrollToEnd = (el: HTMLElement, behavior: ScrollBehavior = "smooth") => {
  const scroller = scrollerRef.value;
  if (scroller?.scrollToBottom) {
    scroller.scrollToBottom({ behavior });
  } else {
    el.scrollTo({ top: el.scrollHeight, behavior });
  }
};

// 是否是第一条消息
const isFirstItem = (index: number): boolean => index === 0;

// 是否显示时间
const shouldDisplayTime = (index: number): boolean => {
  if (index === 0) return true;
  const messages = validMessages.value;
  const curr = messages[index];
  const prev = messages[index - 1];
  if (!curr || !prev) return false;
  return curr.messageTime - prev.messageTime >= TIME_GAP_THRESHOLD;
};

const createSnapshot = (messages: ValidMessageItem[]): MessageSnapshot => ({
  firstId: messages[0]?.messageId ?? null,
  lastId: messages[messages.length - 1]?.messageId ?? null,
  length: messages.length,
});

const messageSnapshot = ref<MessageSnapshot>(createSnapshot(validMessages.value));

const isHeadPrepended = (prev: MessageSnapshot, next: MessageSnapshot) =>
  next.length > prev.length && prev.lastId !== null && next.lastId === prev.lastId && next.firstId !== prev.firstId;

const isTailAppended = (prev: MessageSnapshot, next: MessageSnapshot) =>
  next.length > prev.length && prev.firstId !== null && next.firstId === prev.firstId && next.lastId !== prev.lastId;

const resetScrollState = () => {
  scrollState.value = {
    previousHeight: 0,
    previousTop: 0,
    isLoadingMore: false,
    isAtBottom: true,
  };
};

// 加载更多消息
const loadMoreMessages = async () => {
  if (scrollState.value.isLoadingMore || !hasMoreMessages.value) return;

  const requestId = ++loadMoreRequestId.value;
  const expectedChatId = currentChatId.value;
  const el = getScrollerEl();
  if (!el) return;

  scrollState.value = {
    ...scrollState.value,
    previousHeight: el.scrollHeight,
    previousTop: el.scrollTop,
    isLoadingMore: true,
  };

  try {
    const loaded = await messageStore.handleMoreMessage();
    if (requestId !== loadMoreRequestId.value || currentChatId.value !== expectedChatId) {
      return;
    }
    if (!loaded) {
      scrollState.value.isLoadingMore = false;
    }
  } catch {
    if (requestId !== loadMoreRequestId.value) return;
    scrollState.value.isLoadingMore = false;
  }
};

// 删除会话对象
const handleDelete = async () => {
  if (chatStore.currentChat) {
    await friendStore.handleDeleteContact(chatStore.currentChat);
  }
};

// 清空会话消息
const handleClearMessage = async () => {
  if (chatStore.currentChat) {
    await messageStore.handleClearMessage(chatStore.currentChat);
  }
};

// 滚动到元素底部
const scrollToBottom = async (behavior: ScrollBehavior = "smooth") => {
  await nextTick();

  return new Promise<void>((resolve) => {
    requestAnimationFrame(async () => {
      const el = getScrollerEl();
      if (!el) return resolve();

      try {
        updateScroller();
        const lastIndex = Math.max(0, validMessages.value.length - 1);
        scrollerRef.value?.scrollToItem?.(lastIndex);
        await nextTick();
        scrollToEnd(el, behavior);
      } catch {
        // 兜底 DOM 操作
        el.scrollTop = el.scrollHeight;
      } finally {
        scrollState.value.isAtBottom = true;
        resolve();
      }
    });
  });
};

const scheduleAutoScrollToBottom = (behavior: ScrollBehavior = "smooth") => {
  const state = autoScrollState.value;
  if (behavior === "auto") {
    state.behavior = "auto";
  } else if (state.behavior !== "auto") {
    state.behavior = "smooth";
  }

  if (state.rafId !== null) return;

  state.rafId = requestAnimationFrame(() => {
    const currentBehavior = autoScrollState.value.behavior;
    autoScrollState.value.behavior = "smooth";
    autoScrollState.value.rafId = null;
    void scrollToBottom(currentBehavior);
  });
};

// 检查滚动位置
const checkScrollPosition = () => {
  const el = getScrollerEl();
  if (!el) return;

  const { scrollTop, scrollHeight, offsetHeight } = el;
  const isAtBottom =
    Math.ceil(scrollTop + offsetHeight) >= scrollHeight - SCROLL_BOTTOM_THRESHOLD;

  scrollState.value.isAtBottom = isAtBottom;
};

// 处理滚动事件
const handleScroll = useDebounceFn(checkScrollPosition, 100);

// 加载更多消息完成
const handleLoadMoreComplete = (el: HTMLElement) => {
  const { previousHeight, previousTop } = scrollState.value;
  const delta = el.scrollHeight - previousHeight;
  el.scrollTop = previousTop + delta;
  scrollState.value.isLoadingMore = false;
};

// 处理新消息
const handleNewMessages = async (newLen: number, oldLen: number) => {
  const deltaCount = newLen - oldLen;
  if (deltaCount <= 0) return;

  const messages = validMessages.value;
  const lastMessage = messages[messages.length - 1];
  const isOwnMessage = lastMessage?.isOwner;

  // 自己发送的消息或已在底部时，自动滚动
  if (isOwnMessage || scrollState.value.isAtBottom) {
    scheduleAutoScrollToBottom("smooth");
  }
};

onMounted(() => {
  messageSnapshot.value = createSnapshot(validMessages.value);
  scheduleAutoScrollToBottom("auto");
});

watch(
  () => currentChatId.value,
  async (newChatId, oldChatId) => {
    if (!newChatId || newChatId === oldChatId) return;
    loadMoreRequestId.value++;
    resetScrollState();
    messageSnapshot.value = createSnapshot(validMessages.value);
    if (props.chat?.unread) {
      await chatStore.handleUpdateReadStatus(props.chat);
    }
    scheduleAutoScrollToBottom("auto");
  }
);

// 监听有效消息列表变化
watch(
  () => messageSignature.value,
  async () => {
    await nextTick();
    const el = getScrollerEl();
    if (!el) return;

    updateScroller();

    const prevSnapshot = messageSnapshot.value;
    const nextSnapshot = createSnapshot(validMessages.value);
    const headPrepended = isHeadPrepended(prevSnapshot, nextSnapshot);
    const tailAppended = isTailAppended(prevSnapshot, nextSnapshot);
    const initialFilled = prevSnapshot.length === 0 && nextSnapshot.length > 0;

    if (scrollState.value.isLoadingMore && headPrepended) {
      handleLoadMoreComplete(el);
    } else if (scrollState.value.isLoadingMore && !headPrepended) {
      scrollState.value.isLoadingMore = false;
    }

    if (initialFilled) {
      scheduleAutoScrollToBottom("auto");
    } else if (tailAppended) {
      await handleNewMessages(nextSnapshot.length, prevSnapshot.length);
    }

    messageSnapshot.value = nextSnapshot;
  }
);

onBeforeUnmount(() => {
  const rafId = autoScrollState.value.rafId;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    autoScrollState.value.rafId = null;
  }
});
</script>

<style lang="scss" scoped>
/* 滚动条 mixin（BEM兼容） */
@mixin scroll-bar($width: 6px) {
  &::-webkit-scrollbar-track {
    border-radius: 10px;
    background-color: transparent;
  }

  &::-webkit-scrollbar {
    width: $width;
    height: 10px;
    background-color: transparent;
    transition: opacity 0.3s ease;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 10px;
    background-color: transparent;
  }

  &:hover::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.25)
  }

}

.message-records {
  height: 100%;
  width: 100%;
  position: relative;

  &__list {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: none;
    overflow-anchor: none;
    @include scroll-bar();
  }

  &__empty {
    height: 100%;
    width: 100%;
  }
}
</style>
