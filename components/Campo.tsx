import type { InputHTMLAttributes } from "react";

export function Campo({ rotulo, ...props }: { rotulo: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm text-stone-700">
      {rotulo}
      <input {...props} className="border border-stone-300 rounded-md px-3 py-2 bg-white" />
    </label>
  );
}

export const inputPequeno = "border border-stone-300 rounded-md px-2 py-1 bg-white w-full";
