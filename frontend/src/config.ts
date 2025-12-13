export const isLocalMode = import.meta.env.VITE_LOCAL_MODE === 'true';
export const wsUrl = import.meta.env.VITE_WS_URL as string;
export const healthUrl = import.meta.env.VITE_HEALTH_URL as string;
