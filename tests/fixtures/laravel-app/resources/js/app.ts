import { createInertiaApp } from '@inertiajs/vue3';

createInertiaApp({
    resolve: (name) => import.meta.glob('./Pages/**/*.vue', { eager: true })[`./Pages/${name}.vue`],
});
