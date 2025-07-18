/**
 * Interface que define la estructura del objeto de autenticación.
 * 
 * Propiedades:
 * - id: Identificador único del usuario (opcional).
 * - username: Nombre de usuario o correo electrónico.
 * - password: Contraseña del usuario.
 * - email: Correo electrónico del usuario.
 * - rol: Rol asignado al usuario, que determina la redirección tras el login (opcional).
 * - status: Estado del usuario, puede ser 'Activado' o 'Desactivado' (opcional).
 * - passwordorrandomPassword: Indica si se usa la contraseña real o una contraseña temporal/aleatoria.
 */
export interface auth {
  id?: number;
  username: string;
  password: string; 
  email: string;
  rol?: string;
  status?: 'Activado' | 'Desactivado';
  passwordorrandomPassword?: string;
}
