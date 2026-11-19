# Wandr

> **A slow social network for wanderers.**  
> Una red social para quienes salen a caminar sin necesidad de llegar a ningún lugar.

**Tipo de documento:** Product & Technical Handoff / Documento base de producto  
**Estado:** Visión y stack acordados; requisitos de detalle pendientes  
**Versión:** 0.2  
**Fecha:** 19 de noviembre de 2026  
**Nombre:** Wandr (provisional)

---

## 1. Resumen ejecutivo

**Wandr** es una aplicación social centrada en caminar por placer, curiosidad y bienestar cotidiano, no en el rendimiento deportivo. Permite **registrar la experiencia personal de caminar** y **descubrir el mundo a través de los recorridos y hallazgos de otras personas**.

Combina un diario de caminatas, un atlas comunitario de lugares, un archivo de hallazgos visuales y herramientas sociales deliberadamente tranquilas. Se inspira en la utilidad de Strava para registrar actividades y en la sensibilidad expresiva de Tumblr, pero evita la lógica competitiva, la exposición obligatoria de identidad y la fugacidad del feed tradicional.

**Tesis del producto:** *Strava registra lo que hiciste. Wandr recuerda lo que encontraste.*

### Dos promesas igual de importantes

1. **Mi mundo:** registrar caminatas, conservar fotografías y recuerdos, consultar rachas y estadísticas personales, construir un diario.
2. **El mundo de los demás:** explorar rutas, hallazgos y colecciones; descubrir nuevos lugares; dejar notas y guardar experiencias para futuros paseos.

No son dos productos separados: el contenido personal, cuando alguien decide compartirlo, alimenta de forma segura un atlas colectivo.

---

## 2. Problema y oportunidad

Muchas aplicaciones de movimiento convierten salir a caminar en un entrenamiento: ritmo, kilómetros, comparación, récords y tablas de posiciones. Otras redes sociales privilegian la autopromoción, la viralidad y la novedad constante. Queda espacio para una experiencia donde caminar sea una forma de contemplar, crear memoria y descubrir.

**Job to be done principal:** «Cuando salgo a caminar para despejarme y observar, quiero recordar lo que viví y, cuando me apetezca, compartir y descubrir pequeños lugares especiales sin sentir que estoy compitiendo o exhibiéndome».

### Público inicial

- Personas que caminan por disfrute, calma, exploración o curiosidad.
- Amantes de la fotografía cotidiana, la arquitectura, los parques, los cafés y los detalles de la ciudad.
- Personas que quieren registrar una práctica personal sin presión competitiva.
- Exploradores urbanos y caminantes interesados en rutas compartidas por la comunidad.

### No es

- Una plataforma enfocada en entrenamiento, carreras o marcas deportivas.
- Una copia de Instagram con rutas adjuntas.
- Un feed exclusivamente cronológico de publicaciones efímeras.
- Una aplicación que exige exposición de nombre, rostro, ubicación exacta o redes personales.

---

## 3. Principios de producto

1. **Caminar es suficiente.** No hace falta cumplir metas de velocidad, distancia o calorías.
2. **La experiencia primero.** Una fotografía, una nota o una sensación tienen tanto valor como el track GPS.
3. **Dos modos, un mismo ecosistema.** Diario personal y exploración colectiva reciben atención equivalente.
4. **Lo valioso perdura.** El descubrimiento no depende de lo recién publicado ni del número de likes.
5. **La identidad es discreta.** El foco está en los lugares y las experiencias, no en los creadores.
6. **Privacidad por diseño.** Nadie debería poder inferir fácilmente el hogar, las rutinas o la ubicación actual de otra persona.
7. **Motivación amable.** Rachas y estadísticas inspiran; no avergüenzan ni castigan.
8. **Calma visual.** Interfaz editorial, cálida y expresiva, con poco ruido, sin mecánicas agresivas de engagement.

---

## 4. Modelo conceptual

### 4.1 Walks — Caminatas

Una **Walk** es un episodio personal: alguien salió a caminar y desea registrarlo.

**Campos posibles:** fecha, duración, distancia, recorrido geográfico opcional, título, texto libre, estado de ánimo opcional, fotografías, hallazgos vinculados, música o álbum asociado opcional, visibilidad y timestamps.

**Principios:**

- Puede existir sin GPS ni fotografías, como una entrada breve de diario.
- Es **privada por defecto**.
- Puede editarse después de la caminata.
- Compartir una Walk no obliga a publicar su ruta completa, tiempo exacto, inicio o final.
- La vista pública es una representación saneada o generalizada de la información privada.

### 4.2 Finds — Hallazgos

Un **Find** es un objeto persistente de descubrimiento: un gato dormido al sol, una puerta bonita, un mural, un árbol, una librería o un rincón tranquilo.

**Campos posibles:** fotografías, título opcional, nota, tags/sensaciones, ubicación aproximada o no compartida, asociación opcional con una caminata, fecha pública aproximada y controles de visibilidad.

**Distinción clave:** la Walk registra *una experiencia en el tiempo*; el Find preserva *algo que vale la pena redescubrir*. Un Find puede vivir más tiempo que la caminata que lo originó y aparecer en búsquedas geográficas o temáticas meses después.

### 4.3 Routes — Rutas descubribles

Una **Route** es un recorrido que otras personas pueden explorar o guardar para realizar más adelante. Es distinta de una Walk individual: puede curarse a partir de una caminata, ser editada y describir una experiencia repetible.

**Campos posibles:** geometría pública segura, distancia aproximada, descripción, tipo de ambiente, tags, fotografías, puntos de interés voluntarios y nivel de visibilidad.

**Ejemplos de categorías:** *A quiet morning*, *Coffee & wandering*, *Getting lost in green*, *Little hidden places*. El énfasis está en el ambiente, no en la exigencia física.

### 4.4 Collections — Colecciones

Álbumes duraderos de Finds y Routes guardados o curados por una persona, por ejemplo:

- «Puertas bonitas de la ciudad»
- «Cafés para caminar hasta ellos»
- «Lugares que quiero explorar»
- «Un paseo para los días nublados»

Las colecciones pueden ser privadas o públicas y tener una URL compartible.

---

## 5. Identidad, cuentas y perfiles

La app **no muestra nombres de usuario tipo `@handle` ni identificadores numéricos públicos** como eje de la experiencia. Sí necesita IDs internos para persistencia, autenticación, autorizaciones, reportes y moderación.

### Perfil público

- Avatar ilustrado o abstracto (no exige fotografía personal).
- Título expresivo o frase breve opcional (ej. «Just wandering...»), evitando convertirlo en identificador único rastreable.
- Bio opcional.
- Galería de hallazgos, diarios/rutas que la persona haya decidido publicar.
- Estadísticas públicas **opcionales**; las estadísticas personales son privadas por defecto.
- Enlace a Instagram **estrictamente opcional**, con explicación de que reduce el anonimato.
- URL pública basada en un identificador opaco, no en un handle elegido por el usuario.

### Descubrimiento social

En lugar de centrar la navegación en seguir celebridades o acumular followers, se prioriza seguir/guardar **lugares, rutas, colecciones, temas y sensibilidades**. La posibilidad de seguir perfiles se mantiene como **decisión abierta**, no como requisito del MVP.

**Importante:** «impersonal» no equivale a «anónimo». Fotos, notas, ubicaciones y enlaces externos pueden revelar identidad. El producto debe explicarlo y ofrecer controles reales.

---

## 6. Interacciones sociales

El equivalente a una publicación convencional es un recuerdo consultable y perdurable, especialmente un Find o un diario de Walk.

| Acción | Propósito | Prioridad |
|---|---|---|
| **Save** | Guardar Find, Route o Collection | MVP |
| **Leave a note** | Dejar una nota contextual y duradera | MVP o siguiente iteración |
| **I've been here** | Señalar que también se visitó un lugar, sin exigir prueba de ubicación | Posterior |
| **Add to collection** | Organizar hallazgos y rutas por temas | Posterior |
| **Share a walk** | Publicar una versión segura del diario | MVP |

### Reglas de interacción

- Las notas se asocian a un hallazgo/ruta y pueden seguir siendo relevantes después de mucho tiempo.
- Evitar conteos de likes como métrica predominante, ranking por popularidad y feed infinito basado en urgencia.
- Permitir guardar y reportar contenido; controles de bloqueo y moderación.
- Explorar por cercanía **aproximada**, temática, ambiente y curaduría; no únicamente por recencia.
- Diseñar límites anti-spam, rate limits y moderación desde el comienzo.

---

## 7. Rachas y estadísticas

Se pueden mostrar métricas personales sin convertir la plataforma en una competencia deportiva.

**Métricas sugeridas:**

- Días que saliste a caminar y calendario de actividad.
- Racha actual y mejor racha, sin mensajes punitivos.
- Número de Walks y Finds.
- Distancia total y tiempo caminando cuando existan datos suficientes.
- Zonas o barrios explorados **solo de forma agregada y privada por defecto**.
- Recuerdos de temporadas anteriores y resúmenes de exploración.

**Principios de las rachas:** evitar penalizaciones, streak freezes monetizados, notificaciones culpabilizantes y tablas públicas de kilómetros. Considerar objetivos flexibles por semana, no necesariamente días consecutivos. Los resúmenes deben reflejar datos faltantes sin inventarlos.

---

## 8. Principales experiencias de usuario

### A. Registrar una caminata

1. Abrir la app e iniciar Walk (o crearla manualmente después).
2. Registrar recorrido si hay consentimiento y soporte técnico; también se puede caminar sin seguimiento.
3. Terminar la caminata.
4. Añadir fotografías, notas, sensaciones y Finds.
5. Ver un pequeño diario visual con estadísticas disponibles.
6. Guardarlo privado o compartir una **versión saneada** con opciones explícitas.

### B. Encontrar algo interesante

1. Añadir una foto o nota a un Find, con o sin Walk relacionada.
2. Revisar su ubicación compartida: ninguna / área aproximada / punto específico voluntario.
3. Publicarlo o guardarlo para uno mismo.
4. Encontrarlo después desde el diario, mapa o colección.

### C. Explorar

1. Entrar a **Explore** con mapa y vistas editoriales.
2. Filtrar por lugares, ambientes, recorridos y hallazgos.
3. Abrir Route o Find, leer descripciones y ver fotografías.
4. Guardar una ruta o crear una colección.
5. Opcionalmente dejar una nota o compartir una experiencia propia.

### D. Ver el perfil/diario

1. Consultar Walks, Finds, colecciones y estadísticas personales.
2. Revisar tendencias temporales y calendario de caminatas.
3. Gestionar qué es privado, público o compartido por enlace.
4. Opcionalmente añadir Instagram o una bio.

---

## 9. Navegación propuesta

- **Home / My walks:** diario y acceso rápido para registrar caminata.
- **Explore:** mapa, rutas, hallazgos y filtros temáticos.
- **New / Record:** iniciar o registrar caminata; añadir hallazgo.
- **Saved:** rutas, Finds y colecciones personales.
- **Journal / Profile:** archivo, estadísticas, rachas y preferencias de identidad/privacidad.

En móvil se prioriza una navegación compacta. En escritorio, una presentación editorial con mapa, tarjetas fotográficas y paneles de detalles. Evitar que un feed tradicional se convierta en la única pantalla principal.

---

## 10. Lenguaje visual y tono

### Dirección creativa

**Cozy, contemplativa, analógica y moderna.** Referencias visuales: cuadernos de viaje, fotografía de película, papel y textura, mapas, naturaleza, cafés, calles tranquilas, web personal de los 2000 y cierta sensibilidad Tumblr.

- Paleta sugerida: crema, hueso, verde musgo, marrón café, terracota suave y gris tinta.
- Tipografía: serif editorial para títulos combinada con sans legible para interfaz; monospace en detalles y metadatos.
- Fotografías protagonistas, espacio en blanco generoso, transiciones discretas.
- Microcopy amable, expresivo y no competitivo.
- Componentes accesibles, buen contraste y soporte para reducir movimiento.

### ASCII art

Elemento **secundario**, no la propuesta principal: ilustraciones generativas de árboles, montañas, mapas estilizados, estados vacíos, pequeñas insignias o postales experimentales. Puede convertirse en una característica creativa posterior sin distraer del propósito central.

### Tono de marca

Más «¿qué descubriste?» que «¿cuánto rendiste?». Más «un lugar al que volver» que «nuevo récord personal».

---

## 11. Privacidad, seguridad y confianza

Es un eje funcional, no solo una política legal.

### Requisitos desde el MVP

1. **Walks privadas por defecto.** Ninguna actividad pasa a ser pública sin acción deliberada.
2. **Nunca mostrar GPS en vivo al público.** Preferir publicar al finalizar, con demora opcional o por defecto.
3. **No publicar automáticamente inicio/fin exactos.** Suprimir o generalizar zonas sensibles y revisar manualmente la geometría antes de compartir.
4. **Ubicación granular por Find:** sin ubicación, área aproximada o pin específico voluntario. Advertencia sobre riesgos de compartir pines exactos.
5. **Eliminar EXIF sensible** de medios públicos y generar derivados seguros, sin confiar en que ocultarlo visualmente sea suficiente.
6. **Visibilidad por recurso:** privado / público / enlace no indexado si se decide implementarlo; un enlace no equivale a protección contra reenvío.
7. **Bloqueo, reportes y moderación** para notas, imágenes y contenido de la comunidad.
8. **Controles de borrado y exportación** de información personal; reglas claras de retención de ubicaciones y archivos originales.
9. **Minimización de datos:** pedir permisos solo cuando sean necesarios y no guardar localización precisa innecesariamente.
10. **Protección anti-inferencia:** no exponer series de timestamps y mapas que permitan identificar hogar, trabajo o hábitos. Una geometría pública simplificada puede seguir revelando rutinas.

### Retos de privacidad que requieren diseño detallado

- Detección/recorte de zonas sensibles sin crear nuevos datos sensibles innecesarios.
- Evitar que varias caminatas públicas permitan reconstruir por agregación una ubicación privada.
- No registrar automáticamente la ubicación exacta de una fotografía como parte de un Find público.
- Moderación de fotos de personas, menores, interiores privados o información identificable.
- Evaluar legislación aplicable de datos personales antes del lanzamiento público.

**Regla de arquitectura:** mantener separados el track GPS privado y la geometría pública derivada; nunca reutilizar el mismo campo para ambos propósitos.

---

## 12. Alcance del MVP

El MVP validará el ciclo **caminar → recordar → decidir compartir → descubrir → guardar** en las dos plataformas.

### Incluido (objetivo)

- Autenticación y perfiles seudónimos, sin usernames públicos obligatorios.
- Creación y edición de Walks privadas, con registro manual disponible aun sin GPS.
- Registro móvil con Expo; prototipo de permisos, GPS y recuperación de puntos antes de comprometer soporte background.
- Captura de fotografías y creación de Finds, con ubicación compartida opcional.
- Pipeline de imágenes: almacenamiento privado, metadatos sensibles eliminados y derivados optimizados.
- Publicación voluntaria de recuerdos y Routes a partir de representaciones sanitizadas de datos privados.
- Explore web público e indexable, con mapa/lista, filtros básicos y enlaces compartibles.
- Guardar rutas/hallazgos, diario personal y estadísticas/rachas básicas no competitivas.
- Reportes y controles mínimos de moderación y seguridad.

### Fuera del MVP inicial

- Mensajería privada, rankings competitivos o feed de viralidad.
- Recomendaciones con IA, integraciones musicales, wearables y navegación giro a giro.
- Colaboración en tiempo real y edición avanzada de arte ASCII.
- Sistema de colecciones y notas más sofisticado que el necesario para validar la interacción.

### Condición móvil

La app móvil utilizará **Expo + React Native + Expo Router**. `expo-location` y `expo-task-manager` son candidatos para GPS; la grabación en segundo plano se validará con *development builds* y pruebas físicas en iOS/Android, teniendo en cuenta permisos, suspensión, batería y restricciones de sistema operativo. `expo-sqlite` alojará datos locales necesarios para recuperación/sincronización. No prometer continuidad absoluta del GPS.


## 13. Arquitectura técnica acordada

### Dos clientes, una API y un monolito modular

```text
Wandr Web (React / TanStack Start) ───┐
                                     ├──> Hono API + Better Auth + Zod
Wandr Mobile (Expo / React Native) ──┘                 │
                                            Domain services / Repositories
                                                      │
                                              Drizzle ORM + SQL
                                                      │
                                             PostgreSQL + PostGIS
                                                      │
                                  Object storage R2 + Worker (cuando aplique)
```

**No utilizar Prisma:** **Drizzle** es el único ORM acordado; SQL espacial nativo complementará consultas PostGIS. No se introducirán dos ORMs para las mismas tablas.

### Stack por plataforma y capa

| Capa | Tecnología | Motivo |
| --- | --- | --- |
| Web | React, TypeScript, TanStack Start | Páginas públicas con SSR/SEO y aplicación autenticada |
| Routing web | TanStack Router | Navegación y parámetros tipados |
| Mobile | Expo, React Native, TypeScript, Expo Router | UX móvil y capacidades nativas |
| Datos cliente | TanStack Query | Caché, fetching, invalidación y mutations en ambos clientes |
| Formularios | TanStack Form + Zod | Formularios tipados y validaciones |
| UI web | Tailwind CSS v4 + shadcn/ui/Radix + Motion | Design system web y accesibilidad |
| UI móvil | Componentes RN + Reanimated | Interfaz nativa, sin compartir componentes web directamente |
| API | Hono + TypeScript + Zod | HTTP tipada consumida por web y mobile |
| Autenticación | Better Auth | Sesiones, identidad interna y flujos multiplataforma |
| Persistencia | Drizzle ORM + PostgreSQL/PostGIS | Modelo relacional y consultas geoespaciales |
| Mapas web | MapLibre GL JS | Visualización de rutas/hallazgos en web |
| Mapas móvil | react-native-maps (a validar) | Interacción nativa con mapas |
| Fotos | Cloudflare R2 + Sharp | Almacenamiento y derivados sanitizados |
| GPS/offline móvil | expo-location, expo-task-manager, expo-sqlite | Registro y persistencia local; pruebas en dispositivos |
| Colas | Redis + BullMQ (cuando aporte valor) | Jobs de medios y sincronización reintentable |
| Monorepo | pnpm workspaces + Turborepo | Compartir dominio, contratos y herramientas |
| Calidad | Vitest, Playwright, tests de React Native, GitHub Actions | Validación automatizada |

### Rendering y páginas públicas

- `/` y páginas editoriales: prerender cuando proceda.
- `/explore`, `/routes/:id`, `/finds/:id`, `/collections/:id`: SSR para contenido explícitamente público, con metadata, URLs canónicas y sitemap.
- Perfiles públicos: SSR **solo** para el contenido que el usuario habilite.
- `/app/*`: rutas autenticadas, autorización en API, `noindex` como medida SEO adicional, **no** de seguridad.

### Módulos backend

- Identity & Profiles; Walks & GPS; Finds & Media; Routes & Geospatial; Saves & Collections; Notes & Social; Stats & Streaks; Moderation & Privacy.
- El backend controla autorización **por recurso**. Ningún cliente recibe tracks privados ajenos.
- La web y Expo usan contratos HTTP compartidos (`Zod`) y lógica de dominio desacoplada de UI.

### Archivos y tareas asíncronas

Solicitud autenticada → permiso de subida temporal → almacenamiento privado → validación/sanitización → derivados públicos solo con publicación explícita. Workers y colas se introducen cuando se justifiquen, con operaciones idempotentes.

### Arquitectura de repositorio

```text
wandr/
├── apps/
│   ├── web/                # TanStack Start
│   ├── mobile/             # Expo / React Native
│   ├── api/                # Hono
│   └── worker/             # Jobs cuando hagan falta
├── packages/
│   ├── db/                 # Drizzle + PostGIS
│   ├── domain/             # Reglas de negocio
│   ├── contracts/          # Schemas Zod
│   ├── api-client/         # HTTP client compartido
│   ├── geo/                # Algoritmos espaciales
│   ├── design-tokens/      # Tokens, no componentes nativos/web idénticos
│   └── config/
├── docs/
│   ├── product/
│   ├── design/
│   ├── architecture/
│   └── decisions/
└── infra/
```

### Principio arquitectónico

**Monolito modular + API independiente + workers opcionales.** Evitar microservicios, GraphQL o un ORM adicional sin justificación.


## 14. Modelo de datos inicial (orientativo)

| Entidad | Responsabilidad principal |
| --- | --- |
| `users` | Cuenta interna, autenticación y estado |
| `profiles` | Avatar discreto, bio, Instagram opt-in, preferencias de visibilidad |
| `walks` | Diario privado de caminata, propietario, duración, estado y timestamps |
| `walk_tracks_private` | Puntos/segmentos GPS precisos y protegidos |
| `walk_public_views` | Versión saneada del diario/recorrido publicada voluntariamente |
| `finds` | Hallazgos, notas, tags, ubicación opcional, asociación con Walk |
| `media_assets` | Originales, derivados sanitizados, permisos y estado de procesamiento |
| `routes` | Recorridos curados y geometrias públicas separadas del track original |
| `collections` / `collection_items` | Agrupaciones duraderas de Finds/Routes |
| `saves` | Guardados personales |
| `notes` | Interacciones contextuales con moderación |
| `walk_stats_daily` | Agregados recalculables para métricas y rachas |
| `reports` / `moderation_actions` | Denuncias, auditoría y acciones de moderación |
| `device_sync_operations` | Operaciones móviles reintentables con idempotencia (si se requiere) |

**Reglas de diseño:** separar datos privados de materializaciones públicas; IDs públicos opacos; políticas de autorización en servidor; índices espaciales para geometría pública; no exponer timestamps y coordenadas privadas en respuestas públicas. El esquema Drizzle se definirá tras cerrar M0.


## 15. Requisitos no funcionales

- **Seguridad:** auth robusta, autorización por objeto, validación de entrada, rate limiting, URLs firmadas para medios privados y protecciones contra abuso.
- **Privacidad:** separación física o lógica estricta de GPS privado versus capas públicas, eliminación de metadatos y controles de borrado.
- **Accesibilidad:** navegación por teclado, textos alternativos, contraste, foco visible y prefers-reduced-motion.
- **Rendimiento:** listas virtualizadas si aplica, paginación, clustering de pines, consultas espaciales indexadas, imágenes responsivas y carga diferida.
- **Confiabilidad:** subidas reintentables, workers idempotentes, estados de procesamiento visibles, políticas de fallos.
- **Observabilidad:** logging estructurado sin coordenadas sensibles, métricas de API/workers, alertas y trazas protegidas.
- **Testing:** tests de reglas de privacidad como primera clase; integración PostGIS; E2E de compartir y dejar de compartir.
- **Costos:** límites de tamaño de imágenes, retención definida, políticas de caché y estimación de uso de mapas/storage.

---

## 16. Historias de usuario y aceptación (ejemplos)

### US-01 — Registrar una caminata privada

**Como** caminante, **quiero** guardar un paseo sin compartirlo, **para** recordar mi experiencia.

**Criterios:** puedo crear y editar Walk sin GPS; es privada por defecto; no aparece en Explore ni en perfiles ajenos; sus medios privados no se sirven mediante URL pública permanente.

### US-02 — Publicar un hallazgo

**Como** caminante, **quiero** guardar una fotografía y una nota con localización opcional, **para** conservar o compartir algo que observé.

**Criterios:** puedo subir foto y texto; la ubicación pública es explícita y modificable; los derivados públicos no conservan EXIF sensible; puedo retirar la publicación.

### US-03 — Explorar rutas

**Como** visitante, **quiero** encontrar rutas por zona y ambiente, **para** planificar un paseo.

**Criterios:** veo resultados en mapa/lista, distancia aproximada y descripción; puedo filtrar/guardar; nunca recibo el track privado de otra persona.

### US-04 — Consultar mis estadísticas

**Como** caminante, **quiero** ver historial, rachas y métricas opcionales, **para** apreciar la continuidad de mi hábito.

**Criterios:** no se me exige competir; se distingue lo medido de lo estimado; puedo mantener mis estadísticas privadas.

### US-05 — Identidad discreta

**Como** miembro de la comunidad, **quiero** participar sin un username público obligatorio, **para** centrarme en las experiencias.

**Criterios:** ID interno no expuesto; URL pública opaca; IG es opt-in; mis contenidos públicos pueden reportarse; existen controles de privacidad.

### US-06 — Guardar hallazgos duraderos

**Como** explorador, **quiero** guardar un Find antiguo, **para** revisitarlo después.

**Criterios:** Explore no depende solo de antigüedad; los Finds públicos mantienen enlaces permanentes mientras no se borren; puedo acceder a los guardados.

---

## 17. Roadmap de trabajo

### M0 — Definition

- Consolidar visión y producir PRD MVP.
- Modelar entidades y ciclo de vida de Walk/Route/Find.
- Especificar reglas de privacidad, publicación y minimización de datos.
- Documentar user flows web/mobile, alternativas sin permisos GPS y errores de sincronización.

### M1 — Foundation

- Monorepo pnpm/Turborepo, apps TanStack Start/Expo/Hono, Drizzle + PostgreSQL/PostGIS.
- Mejoras de DX, CI, contratos Zod y autenticación Better Auth.
- Skeleton web público y aplicación móvil.

### M2 — First Walk / Finds

- Crear una Walk privada y agregar hallazgos/fotos.
- Persistencia y endpoints de API; pipeline de archivos.
- Publicación explícita con derivación segura de información.

### M3 — Explore & Social

- Explore público con SSR/SEO, mapas, rutas, filtros, guardados y notas básicas.
- Perfil público opcional, reportes y controles de visibilidad.

### M4 — Tracking & Personal Experience

- Tracking en Expo con permisos, SQLite, recuperación y sincronización validada físicamente.
- Estadísticas, rachas y diario personal.

### M5 — MVP Release

- Seguridad, accesibilidad, pruebas de integración/E2E, rendimiento, monitoreo y despliegue.
- Caso de estudio técnico para portafolio.

Las fases orientan prioridades, no fechas comprometidas. Las exigencias básicas de privacidad y testing son transversales.


## 18. Métricas de producto (sin incentivar adicción)

**North Star candidata:** número de semanas en las que una persona registra al menos una experiencia significativa de caminata o vuelve a explorar un lugar guardado. Debe validarse; no forzar tiempo en pantalla.

Métricas de apoyo:

- Activación: primera Walk o primer Find creado.
- Retención de hábito: semanas con Walk registrada, no sesiones compulsivas.
- Valor de descubrimiento: Routes guardadas y posteriormente marcadas como exploradas voluntariamente.
- Calidad de comunidad: guardados/notas útiles por Find, no vistas infinitas.
- Confianza: porcentaje de publicaciones con ajustes de privacidad revisados, reportes resueltos y errores de exposición de datos (objetivo cero).
- Ingeniería: fallos de subida/procesamiento, tiempos p95 de Explore, tiempo de render del mapa y costo por usuario activo.

---

## 19. Riesgos y decisiones pendientes

| Tema | Riesgo / pregunta | Dirección inicial |
| --- | --- | --- |
| Seguimiento móvil | Restricciones de GPS en segundo plano, permisos y batería | Spike con Expo development builds en iOS/Android |
| Offline | Pérdida o duplicación de puntos al interrumpirse conexión/app | SQLite y operaciones idempotentes; diseñar ciclo de sincronización |
| Privacidad geográfica | Inferir hogar/rutinas con rutas repetidas | Separar tracks privados, sanitizar y revisar versiones públicas |
| SEO | Indexación accidental de contenido privado | SSR únicamente de recursos autorizados y explícitamente públicos |
| Identidad | Perfil seudónimo malinterpretado como anonimato | IDs opacos, controles y advertencias sobre Instagram/fotos |
| Moderación | Abuso en Notes y fotografías | Reportes, bloqueo y límites de frecuencia |
| Mapas | Costos/términos de proveedores de tiles | Evaluar proveedor compatible MapLibre antes del despliegue |
| Rachas | Presión para salir todos los días | Frecuencia flexible y tono no punitivo |
| Cold start | Pocas rutas públicas al inicio | Rutas curatoriales o contenido de prueba bien identificado |

### Decisiones a cerrar en M0

1. Estados exactos de Walk y relación con Route/Find.
2. Campos que pueden compartirse y precisión geográfica mínima segura.
3. Contratos de publicación/despublicación/borrado y comportamiento offline.
4. User flows primarios para web y mobile, incluidos permisos denegados.
5. Prioridad exacta de Notes y Collections para el primer corte funcional.
6. Reglas de estadísticas/rachas y visibilidad de perfiles.


## 20. Qué debe demostrar como proyecto de portafolio

Wandr debe demostrar decisiones justificadas y resultados verificables:

- Producto y UX con restricciones de privacidad geográfica reales.
- React + TanStack Start para web pública indexable; Expo/React Native para aplicación móvil.
- API Hono con contratos Zod, autorización por recurso y dominios delimitados.
- Drizzle + PostgreSQL/PostGIS para modelado y análisis espacial.
- GPS móvil, persistencia offline con SQLite y sincronización robusta.
- Pipeline de fotografía con originales protegidos y derivados sanitizados.
- Testing de privacidad y geodatos, rendimiento, observabilidad y CI/CD.
- ADRs que expliquen trade-offs técnicos; demo y case study documentado.

Entregables: documentación viva versionada, Issues y PRs trazables, arquitectura, pruebas, demos y releases desde GitHub.


## 21. Visión en una frase

**Wandr es un diario personal de caminatas y un atlas colectivo de pequeños descubrimientos: un lugar para salir, observar, recordar y volver a encontrar el mundo, sin competir por atención ni rendimiento.**

---

### Estado de decisiones

**Acordado:** nombre provisional Wandr; dos experiencias principales (diario y descubrimiento); Walks/Finds/Routes; contenido duradero; identidad seudónima sin handles públicos obligatorios; Instagram opcional; estética cozy/editorial; privacidad prioritaria; web React/TanStack Start; mobile Expo/React Native; API Hono; Better Auth; TanStack Query/Form; Drizzle; PostgreSQL/PostGIS; monorepo GitHub-first.

**Pendiente:** PRD detallado, modelo de dominio y datos, UX final, políticas exactas de privacidad, GPS/background y sincronización, escala mínima de moderación, diseño visual final y secuencia precisa del MVP.

**Historial:** este handoff actualiza el documento inicial bajo el nombre AFUERA. Las propuestas anteriores de Next.js, NestJS y Capacitor fueron reemplazadas por las decisiones descritas arriba.
