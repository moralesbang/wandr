# Wandr — Visión de producto

> **A slow social network for wanderers.**  
> Una red social para quienes disfrutan salir a caminar, observar el mundo y conservar pequeños descubrimientos.

**Estado:** visión acordada, detalles de implementación en definición  
**Fecha:** 19 de noviembre de 2026  
**Nombre:** Wandr (provisional)

## La idea

**Wandr** es un diario personal de caminatas y un atlas colectivo de hallazgos. Su centro no es el rendimiento deportivo: caminar vale por el tiempo afuera, la curiosidad, la calma, la fotografía y las historias que aparecen en el camino.

La aplicación ofrece **dos experiencias igualmente importantes**:

1. **Mi mundo:** registrar caminatas, conservar fotografías, escribir recuerdos, observar rachas y estadísticas personales, y volver a visitar un diario visual.
2. **El mundo de los demás:** descubrir rutas, hallazgos, colecciones y lugares compartidos; guardar ideas para próximas caminatas e interactuar sin competir por atención.

Cuando alguien decide compartir una experiencia personal, esta contribuye —solo de forma voluntaria y segura— al archivo comunitario.

## A quién sirve

- Personas que caminan por placer, contemplación y exploración cotidiana.
- Amantes de los cafés, la fotografía callejera, la arquitectura, la naturaleza y los pequeños detalles.
- Caminantes que quieren preservar recuerdos, sin presión por ritmo, récords o kilómetros.
- Personas que encuentran inspiración para salir al ver rutas y hallazgos de otras personas.

## Principios de producto

1. **Caminar es suficiente.** No hace falta entrenar ni alcanzar un objetivo.
2. **Los recuerdos importan.** Fotografías, notas y hallazgos tienen el mismo valor que la distancia recorrida.
3. **Descubrir y recordar.** La experiencia personal y el descubrimiento comunitario tienen igual peso.
4. **Contenido que perdura.** El descubrimiento no depende solo de la recencia o los likes.
5. **Identidad discreta.** No se exigen usernames públicos; la identidad es seudónima, no anónima.
6. **Privacidad por diseño.** Caminatas privadas por defecto, sin GPS público en vivo; publicar no revela automáticamente zonas sensibles.
7. **Motivación amable.** Rachas y estadísticas personales sin rankings competitivos.
8. **Calma visual.** Fotografía protagonista, interfaz editorial cálida, naturaleza y guiños de ASCII art.

## Conceptos principales

| Concepto | Qué representa |
| --- | --- |
| **Walk** | Una experiencia personal de caminata, con GPS opcional, fotos y notas. Privada por defecto. |
| **Find** | Algo significativo descubierto: una foto, una observación, un pequeño lugar. |
| **Route** | Un recorrido curado y compartible, derivado de una geometría segura o construido para descubrir. |
| **Collection** | Una selección duradera de rutas y hallazgos. |
| **Note** | Una interacción contextual, vinculada a contenido, no a un feed efímero. |
| **Profile** | Una presencia pública seudónima con Instagram estrictamente opcional. |

## Diferenciación

- Inspiración en la utilidad de registro de Strava, **sin enfoque deportivo**.
- Sensibilidad expresiva y archivo duradero, cercana a Tumblr, **sin exigir exposición personal**.
- La experiencia pública prioriza **rutas, lugares y hallazgos**, no la popularidad de sus autores.
- Las estadísticas sirven para recordar y celebrar el hábito, no para comparar personas.

## Experiencia por plataforma

- **Web (React + TanStack Start):** landing y páginas públicas indexables, Explore, mapas, rutas, hallazgos, colecciones y perfiles compartibles. También puede ofrecer gestión autenticada.
- **Mobile (Expo + React Native):** registro de caminatas, fotografías, diario, estadísticas y exploración; almacenamiento local y sincronización para escenarios offline.

## Lenguaje visual

**Cozy, editorial, analógico, contemplativo y minimalista.** Fotografía con estética de película, colores crema y verdes apagados, serif expresiva en titulares y monospace en detalles. El ASCII art funciona como acento, no como mecanismo central.

**Paleta y componentes finales:** pendientes de validación en el design system.

## Qué no es Wandr

- Un ranking de rendimiento deportivo.
- Un feed cuya prioridad sea maximizar el tiempo en pantalla.
- Un servicio que publique ubicación o rutina personal automáticamente.
- Un clon de Instagram con una línea GPS sobre cada foto.

## Señal de éxito del MVP

Una persona puede registrar un paseo, conservar sus hallazgos, decidir qué compartir de forma segura y descubrir una ruta/hallazgo de otra persona desde un enlace web. El producto debe resultar útil incluso para quien solo quiere guardar recuerdos privados.

## Decisiones pendientes

- Regla exacta de rachas y métricas.
- Política de visibilidad de perfiles y colecciones.
- Nivel de precisión y sanitización de recorridos públicos.
- Estrategia concreta de GPS en segundo plano y recuperación ante interrupciones.
- Alcance final de Notes y Collections en el MVP.

**Documento complementario:** [`handoff.md`](./handoff.md). El PRD, el modelo de dominio y la política de privacidad se definirán en el milestone **M0 — Definition**.
