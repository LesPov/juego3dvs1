// Este archivo es para el entorno de producción.
// Cuando hagas el build final (`ng build --configuration production`),
// esta debería ser la URL de tu backend en un servidor real.
// Por ahora, usaremos la URL del túnel.

export const environment = {
  production: true,
  // En un despliegue real, aquí iría tu dominio: https://api.tu-dominio.com/
  endpoint: 'https://s7rlvzcx-3001.use2.devtunnels.ms/' 
};