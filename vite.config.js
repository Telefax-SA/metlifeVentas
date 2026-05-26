export default {
  // Usar rutas relativas (./) para que funcione en S3 sin importar el path base
  base: './',
  build: {
    rollupOptions: {
      // No marcar como external - el código ahora usa window.platformClient directamente
    }
  },
  // Asegurar que Vite no intente resolver el paquete npm de purecloud
  optimizeDeps: {
    exclude: ['purecloud-platform-client-v2']
  }
}