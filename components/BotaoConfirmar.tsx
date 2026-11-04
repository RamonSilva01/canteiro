"use client";

import type { ButtonHTMLAttributes } from "react";

// Botão de apagar/remover: só envia o formulário se a pessoa confirmar.
export function BotaoConfirmar({
  pergunta,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pergunta: string }) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(pergunta)) e.preventDefault();
      }}
    />
  );
}
