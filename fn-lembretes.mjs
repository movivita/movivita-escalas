import { q } from "../lib/db.mjs";
import { avisar } from "../lib/push.mjs";
import { dataBR, faixa, hojeSP } from "../lib/util.mjs";

// Envia, uma vez por plantão aceito, o lembrete das 24 horas anteriores ao início.
export default async () => {
  const alvos = await q(
    `SELECT p.id, p.cuidadora_id, to_char(p.data,'YYYY-MM-DD') AS data, p.hora, p.duracao, f.apelido AS familia
       FROM plantoes p JOIN familias f ON f.id=p.familia_id
      WHERE p.status='aceito' AND p.lembrete_enviado=FALSE
        AND p.inicio > NOW() AND p.inicio <= NOW() + interval '24 hours'`
  );
  const hoje = hojeSP();
  for (const p of alvos) {
    const quando = p.data === hoje ? "Hoje" : "Amanhã";
    await avisar([p.cuidadora_id], "Lembrete de plantão", `${quando}, ${dataBR(p.data)}, ${faixa(p.hora, p.duracao)}, ${p.familia}. A família conta com você.`);
    await q("UPDATE plantoes SET lembrete_enviado=TRUE WHERE id=$1", [p.id]);
  }
};

export const config = { schedule: "@hourly" };
