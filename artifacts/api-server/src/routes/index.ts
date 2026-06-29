import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import productsRouter from "./products";
import pricesRouter from "./prices";
import invoicesRouter from "./invoices";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(productsRouter);
router.use(pricesRouter);
router.use(invoicesRouter);

export default router;
