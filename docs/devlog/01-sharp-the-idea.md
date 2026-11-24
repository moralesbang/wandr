- I used claude code to define the brief product, since I don't think to much the format of this artifact.
- Investigate with claude how to implement de design. It comes with interesting ideas about implement a DS.
- Make claude go straight temporally. No branching needed for now.

23 Nov
- Luego de definir los flujos, se diseña con Claude Design el Design system y luego las pantallas clave.
- Una amiga diseñadora me ayuda a revisar el diseño propuesto por Claude y se hacen algunas correcciones sobre colores y contrastes en el dark mode. Se probó introducir un color más en una copia del Design System pero determiné que no aportaba mucho y decidí mantener el original.

24 Nov
- Hemos terminado de definir la arquitectura. Cosas importante que cambiaron un poco el rumbo fueron escoger oxlint para el linter y formatter. Se decide que cada decisión arquitectónica se pone pone como una regla custom del linter y que se haga válida en el CI para evitar usar hooks o poner reglas dentro del Claude.md. También se escoge un enfoque de usar una implementación propia de autenticación (usuarios + sesiones) basado en la idea "Lucia". Es una guía para implementar autenticación propia. La decisión se toma a raíz de que solo tenemos autenticación con email + contraseña.
- 
