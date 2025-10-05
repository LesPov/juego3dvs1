# Juego 3D V1

¡Bienvenido al repositorio oficial de Juego 3D V1! Este proyecto es una aplicación web interactiva desarrollada con Angular que permite a los administradores crear y gestionar mundos 3D y episodios de juego, y a los usuarios explorar e interactuar con ellos.

<!-- Placeholder para una imagen o banner del proyecto -->

<img width="673" height="376" alt="msedge_FSPiLKiZzw" src="https://github.com/user-attachments/assets/85a655ac-7bbb-4839-9f8f-33bdba1d8204" />

## Tabla de Contenidos

1.  [Descripción General](#descripción-general)
2.  [Características Principales](#características-principales)
3.  [Vistas Clave de la Aplicación](#vistas-clave-de-la-aplicación)
    *   [Autenticación (Login)](#autenticación-login)
    *   [Dashboard del Administrador](#dashboard-del-administrador)
    *   [Gestión de Episodios](#gestión-de-episodios)
    *   [Editor de Mundos (Escena 3D)](#editor-de-mundos-escena-3d)
4.  [Estructura del Proyecto](#estructura-del-proyecto)
5.  [Tecnologías Utilizadas](#tecnologías-utilizadas)
6.  [Comenzando](#comenzando)
    *   [Prerrequisitos](#prerrequisitos)
    *   [Instalación](#instalación)
7.  [Scripts Disponibles](#scripts-disponibles)
8.  [Contribuciones](#contribuciones)
9.  [Licencia](#licencia)

## Descripción General

Juego 3D V1 es una plataforma que combina un sistema de gestión de contenido con un motor de renderizado 3D en tiempo real. Los administradores pueden iniciar sesión en un panel de control para construir mundos, definir episodios y configurar la lógica del juego. Los usuarios pueden registrarse, iniciar sesión y experimentar los mundos y episodios creados.

## Características Principales

*   **Autenticación de Usuarios:** Sistema seguro de registro e inicio de sesión para administradores y usuarios.
*   **Panel de Administración:** Un dashboard completo para que los administradores gestionen todos los aspectos del juego.
*   **Editor de Mundos 3D:** Una interfaz intuitiva para crear y editar escenas 3D, añadir objetos, configurar materiales y propiedades.
*   **Gestión de Episodios:** Herramientas para crear, visualizar y organizar los diferentes episodios o niveles del juego.
*   **Roles de Usuario:** Diferenciación clara entre las capacidades de un administrador y un usuario estándar.
*   **Renderizado 3D:** Uso de Three.js para el renderizado de escenas 3D interactivas directamente en el navegador.

## Vistas Clave de la Aplicación

### Autenticación (Login)
<img width="745" height="768" alt="msedge_U8MkmbQYuu" src="https://github.com/user-attachments/assets/9e5952f7-6710-44a6-9e60-09da78500cff" />

La puerta de entrada a la aplicación. Los usuarios y administradores acceden a sus respectivas áreas a través de esta interfaz.

<!-- Placeholder para la imagen de la pantalla de login -->

### Dashboard del Administrador
<img width="1912" height="924" alt="msedge_PEQ38Y53uk" src="https://github.com/user-attachments/assets/70c1f083-96b9-4f06-9588-b1bbe60a1146" />

Una vez que un administrador inicia sesión, es recibido por un dashboard que le da acceso rápido a las principales herramientas de gestión.

<!-- Placeholder para la imagen del Dashboard del Administrador -->

### Gestión de Episodios
<img width="1912" height="924" alt="msedge_YSEz7pRk4Q" src="https://github.com/user-attachments/assets/d6cd4764-9fed-4b24-b682-1b5ecc519a95" />

Desde esta sección, los administradores pueden ver la lista de episodios existentes, crear nuevos y editar sus detalles.

<!-- Placeholder para la imagen de la Gestión de Episodios -->

### Editor de Mundos (Escena 3D)
<img width="1912" height="924" alt="msedge_6jJCcwrybj" src="https://github.com/user-attachments/assets/8f530d9e-365d-4ea3-95f5-754b4363d234" />


https://github.com/user-attachments/assets/dd958bd4-f4ea-466f-a740-e8120a1686ee



https://github.com/user-attachments/assets/feac0a31-3a7b-4a2d-b5fb-918fdf958617


El corazón de la aplicación. Aquí es donde los administradores dan vida a sus mundos. La interfaz incluye:
*   **Visor de Escena:** Una vista en tiempo real del mundo 3D.
*   **Panel de Propiedades:** Para ajustar detalles de objetos, materiales y metadatos.
*   **Barra de Herramientas:** Acciones rápidas para añadir, eliminar y manipular objetos.
*   **Brújula y Controles:** Para navegar fácilmente por la escena.

<!-- Placeholder para la imagen del Editor de Mundos -->
![Editor de Mundos](https.via.placeholder.com/600x400.png?text=Editor+de+Mundos+3D)

## Estructura del Proyecto

El código fuente está organizado de manera modular para facilitar el mantenimiento y la escalabilidad.

```
└── 📁src
    └── 📁app
        ├── 📁core (Guards, Interceptors)
        ├── 📁features
        │   ├── 📁admin (Componentes, Vistas y Servicios del Admin)
        │   ├── 📁auth (Componentes y Servicios de Autenticación)
        │   ├── 📁user (Componentes y Vistas para Usuarios)
        │   └── 📁landing (Página de inicio)
        ├── 📁shared (Componentes y Módulos compartidos)
        └── 📁assets (Imágenes, Modelos 3D, Texturas)
```

## Tecnologías Utilizadas

*   **Frontend:** [Angular](https://angular.io/)
*   **Renderizado 3D:** [Three.js](https://threejs.org/)
*   **Gestión de Estado:** [RxJS](https://rxjs.dev/)
*   **Estilos:** CSS nativo con una estructura modular
*   **Notificaciones:** [ngx-toastr](https://www.npmjs.com/package/ngx-toastr)
*   **Desarrollo Móvil (Capacitor):** [Capacitor](https://capacitorjs.com/)

## Comenzando

Sigue estos pasos para tener una copia del proyecto corriendo en tu máquina local.

### Prerrequisitos

Asegúrate de tener instalado [Node.js](https://nodejs.org/) (que incluye npm). Se recomienda usar `pnpm` para la gestión de paquetes.

```bash
npm install -g pnpm
```

### Instalación

1.  Clona el repositorio:
    ```bash
    git clone https://github.com/tu-usuario/juego3dvs1.git
    ```
2.  Navega al directorio del proyecto:
    ```bash
    cd juego3dvs1
    ```
3.  Instala las dependencias:
    ```bash
    pnpm install
    ```

## Scripts Disponibles

En el directorio del proyecto, puedes ejecutar:

*   `pnpm start`: Inicia el servidor de desarrollo. Navega a `http://localhost:4200/`. La aplicación se recargará automáticamente si cambias algún archivo fuente.
*   `pnpm build`: Compila el proyecto. Los artefactos de la compilación se almacenarán en el directorio `dist/`.
*   `pnpm test`: Ejecuta los tests unitarios a través de [Karma](https://karma-runner.github.io).
*   `pnpm ng generate component component-name`: Genera un nuevo componente. También puedes usar `directive`, `pipe`, `service`, `class`, `guard`, `interface`, `enum` y `module`.

## Contribuciones

Las contribuciones son lo que hacen que la comunidad de código abierto sea un lugar increíble para aprender, inspirar y crear. Cualquier contribución que hagas será **muy apreciada**.

1.  Haz un Fork del Proyecto
2.  Crea tu Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commitea tus Cambios (`git commit -m 'Add some AmazingFeature'`)
4.  Haz Push a la Branch (`git push origin feature/AmazingFeature`)
5.  Abre un Pull Request

## Licencia

Distribuido bajo la Licencia MIT. Ver `LICENSE` para más información.
