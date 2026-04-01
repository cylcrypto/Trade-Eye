import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalsRouter from "./signals";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalsRouter);
router.use(telegramRouter);

export default router;
