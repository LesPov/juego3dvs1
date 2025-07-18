export interface Profile {
  userId: number;
  firstName: string;
  lastName: string;
  identificationType: string;
  identificationNumber: string;
  biography: string;
  direccion: string;
  birthDate?: string;
  gender: 'Mujer' | 'Hombre' | 'Otro género' | 'Prefiero no declarar';
  profilePicture?: string; // <-- Asegura que pueda ser undefined
  status?: 'pendiente' | 'aprobado' | 'rechazado';
  campiamigo?: boolean; // Este campo se usará para identificar si el usuario aceptó ser "Campiamigo"
  zoneId?: number;
}
