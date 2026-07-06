import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import productsRouter from "./products";
import pricesRouter, { publicPricesRouter } from "./prices";
import invoicesRouter from "./invoices";
import settingsRouter, { publicSettingsRouter } from "./settings";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(publicPricesRouter);
router.use(publicSettingsRouter);

router.use(requireAuth);

router.use(usersRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(productsRouter);
router.use(pricesRouter);
router.use(invoicesRouter);
router.use(settingsRouter);

export default router;
