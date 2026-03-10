<template>
  <el-header>
    <el-row class="header-row">
      <el-col :span="20" class="header-main" data-tauri-drag-region>
        <div class="chat-header">
          <Search />
        </div>
        <div class="chat-header-name">
          <Name data-tauri-drag-region></Name>
        </div>
      </el-col>
      <el-col :span="4" class="header-actions">
        <el-row v-if="!isMacPlatform" class="actions-top">
          <System about-visible />
        </el-row>
        <el-row v-else class="actions-top drag-only" data-tauri-drag-region></el-row>

        <el-row class="actions-bottom">
          <el-col :span="18"></el-col>
          <el-col :span="6" class="detail-entry">
            <el-button v-if="chatStore.getShowDetailBtn" class="control-el-button" link
              @click="chatStore.handleChatDetail">
              <i class="iconfont icon-sandian" style="font-size: 25px"></i>
            </el-button>
          </el-col>
        </el-row>
      </el-col>
    </el-row>
  </el-header>
</template>

<script lang="ts" setup>
import Search from "@/components/Search/index.vue";
import System from "@/components/System/index.vue";
import { useSystemClose } from "@/hooks/useSystem";
import { useChatStore } from "@/store/modules/chat";
import Name from "./name/index.vue";

const { currPlatform } = useSystemClose();
const chatStore = useChatStore();
const isMacPlatform = computed(() => currPlatform === "macos" || currPlatform === "ios");
</script>

<style lang="scss" scoped>
.title {
  color: #909399;
  font-size: 16px;
  line-height: 40px;
}

.chat-header {
  height: 60px;
  width: 240px;
  float: left;
}

.chat-header-name {
  width: 100%;
}

.header-row,
.header-main,
.header-actions {
  height: 60px;
}

.actions-top,
.actions-bottom {
  height: 30px;
}

.actions-bottom {
  align-items: center;
}

.detail-entry {
  display: flex;
  justify-content: flex-end;
}

.drag-only {
  width: 100%;
}

.el-header {
  line-height: unset;
  height: 60px;
  padding: 0;
  border-bottom: 1px solid var(--header-border-bottom-color);
  background-color: var(--header-bg-color);
}
</style>
