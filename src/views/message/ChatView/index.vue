<template>
  <div ref="boxRef" class="vl-box" @scroll="handleScroll">
    <div :style="{ height: boxHeight + 'px' }">
      <!-- 虚拟列表项，携带绝对索引 absIndex -->
      <div
        v-for="({ item, absIndex }, idx) in offsetData"
        :key="absIndex + '_' + item.chatId"
        :style="{ height: rowHeight + 'px', top: absIndex * rowHeight + 'px' }"
        class="vl-box-item"
      >
        <!-- 使用@contextmenu指令监控右击事件并阻止事件冒泡 -->
        <div
          :class="{ pinned: item.isTop == 1, active: isActive(item) }"
          class="item"
          @contextmenu.capture.prevent="e => handleContextmenu(item, e)"
          @click="handleChooseChat(item)"
        >
          <ItemView :data="item" />
        </div>
      </div>
      <!-- 引入el-dropdown组件用于显示会话列表的右键菜单 -->
      <el-dropdown
        ref="menuRef"
        :virtual-ref="triggerRef"
        :show-arrow="false"
        :popper-options="{
          modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
        }"
        virtual-triggering
        trigger="contextmenu"
        placement="bottom-start"
        @command="handleMenuCommand"
      >
        <template #dropdown>
          <el-dropdown-menu>
            <!-- 根据被选会话动态渲染菜单选项 -->
            <el-dropdown-item
              v-for="option in menuConfig.options"
              :key="option.value"
              :command="option.value"
              :icon="getIconComponent(option.icon)"
              :divided="option.divided"
              :style="{ 'user-select': 'none' }"
            >
              {{ option.label }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 空状态 -->
    <div v-if="!chatMessageStore.loading && totalCount === 0" class="vl-empty">
      <el-empty />
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type Chats from "@/database/entity/Chats";
  import { useChatStore } from "@/store/modules/chat";
  import { useMediaCacheStore } from "@/store/modules/media";
  import { ArrowDownBold, ArrowUpBold, Bell, Delete, MuteNotification } from "@element-plus/icons-vue";
  import { useWindowSize } from "@vueuse/core";
  import type { DropdownInstance } from "element-plus";
  import { computed, reactive, ref } from "vue";
  import ItemView from "./ItemView/index.vue";

  // 定义右键菜单动作类型
  type MenuAction = "pin" | "mute" | "delete";

  // 定义下拉菜单选项类型接口
  interface DropdownOption {
    value: MenuAction;
    label: string;
    icon?: string;
    divided?: boolean;
  }

  // 假设 chatMessageStore 的类型（示例）
  interface ChatMessageStore {
    getChatById: (chatId: string | number) => Chats | undefined;
    handleDeleteChat: (chat: Chats) => Promise<void>;
    handlePinChat: (chat: Chats) => Promise<void>;
    handleMuteChat: (chat: Chats) => Promise<void>;
  }

  const chatMessageStore = useChatStore();
  const mediaStore = useMediaCacheStore();

  const iconMap = {
    ArrowDownBold,
    ArrowUpBold,
    Bell,
    MuteNotification,
    Delete,
  };

  const menuRef = ref<DropdownInstance>();

  const triggerRef = ref({
    getBoundingClientRect: () => menuPosition.value,
  });

  const { height: windowHeight } = useWindowSize();
  const boxRef = ref<HTMLElement | null>(null);
  const selectedId = ref<string | number | null>((chatMessageStore as any).currentChat?.chatId ?? null);

  const rowHeight = 60;
  const offset = ref(0);
  const offsetIndex = ref(0);
  let rafId: number | null = null;

  const totalCount = computed(() => chatMessageStore.chatList.length ?? 0);
  const boxHeight = computed(() => (chatMessageStore.chatList.length ?? 0) * rowHeight);

  // 注意：保持 item 的引用不被 clone，slice 返回的仍是原始对象引用，子组件可以响应更新
  const offsetData = computed(() => {
    const data = chatMessageStore.chatList || [];
    if (!data.length) return [] as { item: Chats; absIndex: number }[];
    const visibleCount = Math.ceil(windowHeight.value / rowHeight) + 1;
    const startIndex = Math.floor(offset.value / rowHeight);
    offsetIndex.value = startIndex;
    return data.slice(startIndex, startIndex + visibleCount).map((item, i) => ({ item, absIndex: startIndex + i }));
  });

  const handleScroll = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (boxRef.value) offset.value = boxRef.value.scrollTop;
      rafId = null;
    });
  };

  const handleChooseChat = async (item: Chats) => {
    selectedId.value = item.chatId;
    chatMessageStore.handleResetMessage();
    await mediaStore.initStorage(item.toId);
    await chatMessageStore.handleChangeCurrentChat(item);
    await chatMessageStore.handleGetMessageList(item);
    await chatMessageStore.handleUpdateReadStatus(item);
  };

  const isActive = (item: Chats) => {
    if (!item) return false;
    const storeCur = (chatMessageStore as any).currentChat?.chatId ?? null;
    if (storeCur != null) return item.chatId === storeCur;
    return item.chatId === selectedId.value;
  };

  // 右键菜单位置(注意:这里必须使用ref定义)
  const menuPosition = ref({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  } as DOMRect);

  // 右键菜单配置:options是菜单项动态计算,currentCallback是调用的回调函数
  const menuConfig = reactive({
    options: [] as DropdownOption[],
    // 用于存储当前会话的回调函数
    currentCallback: async (action: MenuAction) => {},
  });

  // 右键触发方法(核心:同步选项和回调函数到menuConfig对象中)
  const handleContextmenu = (item: Chats, event: MouseEvent) => {
    event.preventDefault();

    // 右键菜单弹出的位置就是鼠标指针所处的位置
    const { clientX, clientY } = event;
    menuPosition.value = DOMRect.fromRect({ x: clientX, y: clientY });

    // 响应式获取当前会话(基于已封装好的store)
    const currentItem: ComputedRef<Chats> = computed(() => {
      return chatMessageStore.getChatById(item.chatId) ?? item;
    });

    // 动态生成菜单表项(基于computed)
    const getMenuOptions: ComputedRef<DropdownOption[]> = computed(() => {
      const chat = currentItem.value;
      if (!chat) return [];
      return [
        {
          value: "pin",
          label: chat.isTop === 1 ? "取消置顶" : "置顶会话",
          // icon: chat.isTop === 1 ? "ArrowDownBold" : "ArrowUpBold",
          divided: false,
        },
        {
          value: "mute",
          label: chat.isMute === 1 ? "取消免打扰" : "消息免打扰",
          // icon: chat.isMute === 1 ? "MuteNotification" : "Bell",
          divided: false,
        },
        {
          value: "delete",
          label: "删除会话",
          // icon: "Delete",
          divided: true,
        },
      ];
    });

    // 将动态生成的菜单表项赋值给menuConfig.options触发响应式更新
    menuConfig.options = getMenuOptions.value;

    // 定义当前会话的回调函数并绑定到menuConfig
    const callback = async (action: MenuAction) => {
      const chat = currentItem.value;
      try {
        switch (action) {
          case "pin":
            await chatMessageStore.handlePinChat(chat);
            break;
          case "mute":
            await chatMessageStore.handleMuteChat(chat);
            break;
          case "delete":
            const isConfirm = await ElMessageBox.confirm(`确定删除与 ${chat.name} 的会话?`, "删除会话", {
              distinguishCancelAndClose: true,
              confirmButtonText: "确认",
              cancelButtonText: "取消",
              type: "warning",
            }).catch(() => false);

            if (isConfirm) {
              await chatMessageStore.handleDeleteChat(chat);
              ElMessage.success("会话已删除");
            }
            break;
          default:
            const _exhaustiveCheck: never = action;
            throw new Error(`不支持的菜单动作: ${_exhaustiveCheck}`);
        }
      } catch (error) {
        if ((error as Error).message !== "cancel") {
          console.error("菜单操作失败:", error);
          ElMessage.error("操作失败，请稍后重试");
        }
      }
    };

    // 把当前会话的回调绑定到menuConfig，供模板点击时调用
    menuConfig.currentCallback = callback;

    // 处理右键菜单打开事件
    menuRef.value?.handleOpen();

    // 处理当右键菜单打开时用户触发滚轮滚动事件
    //  - 1.禁止滚轮滚动事件
    //  - 2.当触发滚轮滚动事件时，关闭右键菜单
    // 目前选择的是方案2:可考虑优化当滚动条位置在最顶部/最底部时，向上/向下滚动不触发菜单关闭
    boxRef.value?.addEventListener("wheel", handleChatListWheel, { passive: true });
  };

  // 模板中菜单点击的统一处理方法(本质上还是调用currentCallback，只是在此之上增加了一层封装，使其更加健壮)
  const handleMenuCommand = async (action: MenuAction) => {
    // 调用当前绑定的回调函数
    await menuConfig.currentCallback(action);
    // 执行完操作后关闭菜单
    menuRef.value?.handleClose();
  };

  const handleChatListWheel = () => {
    menuRef.value?.handleClose();
  };

  // 映射icon名称到icon组件
  const getIconComponent = (iconName?: string) => {
    return iconName ? iconMap[iconName as keyof typeof iconMap] : undefined;
  };

  // 改造的 getMenuConfig：使用 computed 跟踪 item.isTop，并通过 getter 暴露 options（保持外部使用不变）
  // const getMenuConfig = (item: Chats) => {
  //   // 获取当前item
  //   const currentItem = computed(() => chatMessageStore.getChatById(item.chatId) ?? item);
  //   console.log("currentItem", currentItem.value);

  //   const options = computed(() => [
  //     { label: currentItem.value?.isTop === 1 ? "取消置顶" : "置顶会话", value: "pin" },
  //     { label: currentItem.value?.isMute === 1 ? "取消免打扰" : "消息免打扰", value: "mute" },
  //     { label: "删除会话", value: "delete" },
  //   ]);

  //   const callback = async (action: string) => {
  //     try {
  //       if (action === "delete") {
  //         await ElMessageBox.confirm(`确定删除与 ${currentItem.value?.name ?? item.name} 的会话?`, "删除会话", {
  //           distinguishCancelAndClose: true,
  //           confirmButtonText: "确认",
  //           cancelButtonText: "取消",
  //         });
  //         await chatMessageStore.handleDeleteChat(currentItem.value ?? item);
  //       }
  //       if (action === "pin") {
  //         await chatMessageStore.handlePinChat(currentItem.value ?? item);
  //       }
  //       if (action === "mute") {
  //         await chatMessageStore.handleMuteChat(currentItem.value ?? item);
  //       }
  //     } catch {}
  //   };

  //   return {
  //     get options() {
  //       return options.value;
  //     },
  //     callback,
  //   };
  // };
  onBeforeUnmount(() => {
    // 移除事件监听器
    boxRef.value?.removeEventListener("wheel", handleChatListWheel);
  });
</script>

<style lang="scss" scoped>
  @use "@/assets/style/scss/index.scss" as *;

  .vl-box {
    border-right: 1px solid var(--side-border-right-color);
    overflow-y: auto;
    height: 100%;
    @include scroll-bar();
  }

  .vl-box::-webkit-scrollbar-button:decrement {
    display: none;
  }

  .vl-box > div {
    position: relative;
    overflow: hidden;
  }

  .vl-box-item {
    position: absolute;
    width: 100%;
    box-sizing: border-box;
  }

  .item {
    cursor: pointer;
    user-select: none;
    transition: background 0.2s ease;

    /* 置顶样式保持原来语义 */
    &.pinned {
      // background-color: var(--side-active-bg-color);
      background-color: #f2f2f2;
      color: var(--side-active-color);
    }

    &:hover {
      background-color: #e7e6e6d4;
    }

    &.active {
      background-color: #e5e5e5;
    }
  }

  html.dark .item {
    cursor: pointer;
    user-select: none;
    transition: background 0.2s ease;
    &.pinned {
      background-color: #504f4f;
      color: var(--side-active-bg-color);
    }

    &:hover {
      background-color: #4a4949;
    }

    &.active {
      background-color: #585757;
    }
  }

  .vl-empty {
    position: absolute;
    left: 0;
    right: 0;
    top: 15%;
    // transform: translateY(-50%);
    // text-align: center;
    color: var(--muted-color);
    font-size: 14px;
  }
</style>
