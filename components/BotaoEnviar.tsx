"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

// Trava o botão enquanto o formulário envia: evita o segundo clique gastar de novo um link de uso único.
export function BotaoEnviar({ enviando, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { enviando?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} {...props}>
      {pending ? (enviando ?? "Aguarde...") : children}
    </button>
  );
}
