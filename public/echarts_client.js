import * as echarts from "echarts/core"
import {
  BarChart,
  HeatmapChart,
  LineChart,
  MapChart,
} from "echarts/charts"
import {
  DataZoomComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TimelineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([
  CanvasRenderer,
  LineChart,
  BarChart,
  MapChart,
  HeatmapChart,
  GridComponent,
  GeoComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  TitleComponent,
  VisualMapComponent,
  GraphicComponent,
  MarkLineComponent,
  ToolboxComponent,
  TransformComponent,
  TimelineComponent,
])

export default echarts
