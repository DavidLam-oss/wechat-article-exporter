<template>
  <UCard class="mx-4 mt-10">
    <template #header>
      <h3 class="text-2xl font-semibold">代理节点</h3>
      <p class="text-sm text-slate-10 font-serif">
        若此处留空，则网站将使用
        <ExternalLink :href="docsWebSite + '/get-started/proxy.html'" text="公共代理" /> 进行资源下载。
      </p>
      <p>
        <ExternalLink :href="docsWebSite + '/get-started/private-proxy.html'" text="如何搭建代理节点？" />
      </p>
    </template>

    <div class="flex space-x-10">
      <textarea
        class="h-[400px] flex-1 p-2 border rounded resize-none font-mono"
        v-model="textareaValue"
        spellcheck="false"
        placeholder="请填写私有部署的代理地址，一行一个"
      ></textarea>
      <div class="flex-1 flex-shrink-0">
        <div class="my-5">
          <p>代理节点地址要求：</p>
          <ol>
            <li>
              <p>1. 以 <code class="text-rose-500 font-mono">http/https</code> 开头的绝对路径地址。</p>
              <p>
                2. 该地址在使用时后面会自动拼接
                <code class="text-rose-500 font-mono">?url=</code> 等参数，请确保格式正确。
              </p>
            </li>
          </ol>
          <p class="mt-3">代理示例：</p>
          <p><code class="text-rose-500 font-mono">https://wproxy-01.deno.dev</code></p>
          <p><code class="text-rose-500 font-mono">https://wproxy-01.deno.dev/</code></p>
        </div>
        <div class="flex gap-1 items-center mt-5 mb-2">
          <UCheckbox
            v-model="preferences.enableLocalServerProxy"
            name="enableLocalServerProxy"
            label="允许使用本地服务器代理抓取文章内容"
          />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm text-gray-500">
                如果开启（默认），且未配置任何有效的私有代理时，系统会自动利用运行在您本地的后台服务器作为代理来拉取公众号文章 HTML。<br />
                这能绕过公用 Cloudflare 代理被拦截的问题，因为本地请求使用的是您自身的家庭/办公网络 IP。
              </p>
            </template>
            <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
          </UPopover>
        </div>
        <UButton type="submit" @click="save" color="black" class="w-20 mt-3 justify-center disabled:bg-slate-10">{{
          saveBtnText
        }}</UButton>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import ExternalLink from '~/components/base/ExternalLink.vue';
import { docsWebSite } from '~/config';
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const textareaValue = ref('');
const proxyList = computed(() => {
  return textareaValue.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('http'));
});

onMounted(() => {
  try {
    const configuredProxyList = (preferences.value as Preferences).privateProxyList;
    if (configuredProxyList.length > 0) {
      textareaValue.value = configuredProxyList.join('\n');
    }
  } catch (e) {}
});

const saveBtnText = ref('保存');
async function save() {
  saveBtnText.value = '保存成功';
  setTimeout(() => {
    (preferences.value as Preferences).privateProxyList = proxyList.value;
    saveBtnText.value = '保存';
  }, 1000);
}
</script>
