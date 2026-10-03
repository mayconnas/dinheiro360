/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // build enxuto para container (copia só o necessário p/ rodar)
  output: "standalone",
  experimental: {
    // Cache do router no cliente: ao voltar a uma aba visitada há pouco,
    // reusa o conteúdo em vez de re-renderizar tudo no servidor. No Next 15
    // o padrão é 0 (sempre refaz) — isso deixa a troca de abas lenta.
    staleTimes: {
      dynamic: 30, // páginas dinâmicas: reusa por 30s
      static: 180,
    },
  },
};

export default nextConfig;
