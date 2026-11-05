import "server-only";

// Fotos e feed estão prontos, mas desligados: alimentar exige trabalho a mais do time da obra.
// Para ligar: variável FEED_ATIVO=1 na Vercel e publicar de novo.
export const feedAtivo = () => process.env.FEED_ATIVO === "1";
