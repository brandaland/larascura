<script setup>
defineProps({
    stats: { type: Object, required: true },
});
</script>

<template><div>{{ stats }}</div></template>
