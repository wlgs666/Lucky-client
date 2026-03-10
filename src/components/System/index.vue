<template>
  <div :class="{ mac: isMac }" :style="containerStyle" aria-label="window controls" class="control-button"
    role="toolbar">
    <template v-if="isMac">
      <button v-for="btn in macButtons" :key="btn.key" :aria-label="btn.title"
        :class="['mac-traffic-light', btn.key, { disabled: btn.disabled }]" :disabled="btn.disabled" :title="btn.title"
        type="button" @click="btn.handle" @mouseenter="hoveredButton = btn.key" @mouseleave="hoveredButton = ''">
        <span :class="[
          'mac-symbol',
          btn.key,
          {
            visible: hoveredButton === btn.key,
            restore: btn.key === 'max' && isMaximized
          }
        ]" />
      </button>
    </template>

    <template v-else>
      <el-button v-for="(btn, index) in windowsButtons" :key="index" :class="`${btn.css} btn-w-${index}`"
        :disabled="btn.disabled" :style="btn.style" :title="btn.title" @click="btn.handle">
        <i :class="btn.icon" class="iconfont"></i>
      </el-button>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { useSystemClose } from "@/hooks/useSystem";
import { getCurrentWindow } from "@tauri-apps/api/window";

type MacButtonKey = "close" | "min" | "max";

const emit = defineEmits(["handleClose"]);
const appWindow = getCurrentWindow();

const { currPlatform, close } = useSystemClose(() => {
  emit("handleClose");
});

const props = defineProps({
  aboutVisible: { type: Boolean, default: true },
  maxVisible: { type: Boolean, default: true },
  minVisible: { type: Boolean, default: true },
  closeVisible: { type: Boolean, default: true }
});

const { maxVisible, minVisible, closeVisible } = toRefs(props);

const isMaximized = ref(false);
const isMac = ref(false);
const hoveredButton = ref<MacButtonKey | "">("");

const macButtons = computed(() => [
  {
    key: "close" as const,
    title: "关闭",
    disabled: !closeVisible.value,
    handle: closeHandle
  },
  {
    key: "min" as const,
    title: "最小化",
    disabled: !minVisible.value,
    handle: minHandle
  },
  {
    key: "max" as const,
    title: isMaximized.value ? "还原" : "最大化",
    disabled: !maxVisible.value,
    handle: maxHandle
  }
]);

const windowsButtons = computed(() => [
  {
    title: "最小化",
    icon: "icon-zuixiaohua",
    style: { opacity: minVisible.value ? 1 : 0.5 },
    disabled: !minVisible.value,
    css: "control-el-button",
    handle: minHandle
  },
  {
    title: isMaximized.value ? "还原" : "最大化",
    icon: "icon-zuidahua-da",
    style: { opacity: maxVisible.value ? 1 : 0.5 },
    disabled: !maxVisible.value,
    css: "control-el-button",
    handle: maxHandle
  },
  {
    title: "关闭",
    icon: "icon-guanbi",
    style: { opacity: closeVisible.value ? 1 : 0.5 },
    disabled: !closeVisible.value,
    css: "control-el-button close",
    handle: closeHandle
  }
]);

const minHandle = async () => {
  await appWindow.minimize();
};

const maxHandle = async () => {
  await appWindow.toggleMaximize();
  isMaximized.value = await appWindow.isMaximized();
};

const closeHandle = async () => {
  await close();
};

onMounted(async () => {
  isMac.value = currPlatform === "macos" || currPlatform === "ios";
  isMaximized.value = await appWindow.isMaximized();
});

const containerStyle = computed(() => ({
  position: "absolute",
  left: isMac.value ? "5px" : "auto",
  top: isMac.value ? "6px" : "auto",
  right: isMac.value ? "auto" : "-1px",
  zIndex: 2,
  pointerEvents: "auto"
})) as any;
</script>

<style lang="scss" scoped>
.control-button {
  position: absolute;
  height: 32px;
  z-index: 2;
  pointer-events: auto;
  box-sizing: border-box;

  &.mac {
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
  }

  .mac-traffic-light {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    position: relative;
    transition: filter 0.18s ease, opacity 0.18s ease;

    &.close {
      background: #ff5f57;
    }

    &.min {
      background: #ffbd2e;
    }

    &.max {
      background: #28c940;
    }

    &:hover {
      filter: brightness(0.92);
    }

    &.disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  .mac-symbol {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.12s ease;

    &.visible {
      opacity: 1;
    }

    &::before,
    &::after {
      content: "";
      position: absolute;
      background: rgba(40, 40, 40, 0.8);
      border-radius: 1px;
    }

    &.close {

      &::before,
      &::after {
        width: 8px;
        height: 1.5px;
        top: 6px;
        left: 3px;
      }

      &::before {
        transform: rotate(45deg);
      }

      &::after {
        transform: rotate(-45deg);
      }
    }

    &.min::before {
      width: 8px;
      height: 1.5px;
      left: 3px;
      top: 6px;
    }

    &.max::before {
      width: 8px;
      height: 1.5px;
      left: 3px;
      top: 6px;
    }

    &.max::after {
      width: 1.5px;
      height: 8px;
      left: 6px;
      top: 3px;
    }

    &.max.restore::after {
      display: none;
    }
  }

  &:not(.mac) {
    width: 110px;

    .control-el-button {
      position: absolute;
      top: -1px;
      margin: 0;
      padding: 0;
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: center;
      transition: background-color 0.2s ease, color 0.2s ease;

      &:hover {
        background-color: rgba(130, 129, 129, 0.12);
      }

      &.close:hover {
        background-color: #e8595b;
        color: #ffffff;
      }
    }

    .btn-w-0 {
      right: 72px;
      width: 35px;
      height: 35px;
    }

    .btn-w-1 {
      right: 36px;
      width: 35px;
      height: 35px;
    }

    .btn-w-2 {
      right: 0;
      width: 35px;
      height: 35px;
    }
  }
}
</style>
