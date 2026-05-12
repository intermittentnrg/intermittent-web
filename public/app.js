import { Application } from "@hotwired/stimulus";
import ChartController from "./controllers/chart_controller.js";
import TopnavAreaController from "./controllers/topnav_area_controller.js";
import TopnavDateController from "./controllers/topnav_date_controller.js";
import TopnavDashboardController from "./controllers/topnav_dashboard_controller.js";
import DashboardOptionsController from "./controllers/dashboard_options_controller.js";
import { router } from "./router.js";

const application = Application.start();
application.debug = false;
window.Stimulus = application;

application.register("chart", ChartController);
application.register("topnav-area", TopnavAreaController);
application.register("topnav-date", TopnavDateController);
application.register("topnav-dashboard", TopnavDashboardController);
application.register("dashboard-options", DashboardOptionsController);

router.init();
