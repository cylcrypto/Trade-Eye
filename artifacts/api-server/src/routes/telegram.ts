import { Router, type IRouter, type Request, type Response } from "express";
import { sendTelegram } from "../lib/telegram.js";

const router: IRouter = Router();

router.get("/test-telegram", async (_req: Request, res: Response) => {
  try {
    const success = await sendTelegram(
      "🤖 <b>TRADEYE — Test de connexion</b>\nLe bot est opérationnel et les alertes sont actives."
    );
    res.json({
      success,
      message: success
        ? "Message envoyé avec succès"
        : "Échec de l'envoi (vérifier TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID)",
      env: {
        BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        CHAT_ID: !!process.env.TELEGRAM_CHAT_ID,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Erreur serveur", error: String(err) });
  }
});

export default router;
