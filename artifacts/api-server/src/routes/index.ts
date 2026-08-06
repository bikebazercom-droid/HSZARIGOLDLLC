import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import productsRouter from "./products";
import priceItemsRouter, { publicPriceItemsRouter } from "./price-items";
import invoicesRouter from "./invoices";
import stockRouter from "./stock";
import settingsRouter from "./settings";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(publicPriceItemsRouter);

router.use(requireAuth);

router.use(usersRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(productsRouter);
router.use(priceItemsRouter);
router.use(invoicesRouter);
router.use(stockRouter);
router.use(settingsRouter);

export default router;
