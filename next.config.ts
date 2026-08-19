import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * PGlite trae Postgres como un binario WASM y lo carga desde su propio
   * paquete en disco. Si el bundler del servidor lo empaqueta, esa resolución
   * pasa a ser una URL y `readFileSync` la rechaza. Dejarlo externo es la forma
   * soportada de que se cargue como un módulo de Node normal.
   */
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
