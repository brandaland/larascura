<script setup lang="ts">
defineProps<{
    orders: Array<{ id: number }>;
    filters?: Record<string, string>;
}>();
</script>

<template>
    <ul><li v-for="order in orders" :key="order.id">{{ order.id }}</li></ul>
</template>
