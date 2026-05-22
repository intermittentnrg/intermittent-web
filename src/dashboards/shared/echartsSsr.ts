let registered = false;

export async function getEchartsForSsr() {
  const [
    echarts,
    canvasRenderer,
    lineChart,
    barChart,
    mapChart,
    heatmapChart,
    scatterChart,
    gridComponent,
    geoComponent,
    tooltipComponent,
    legendComponent,
    dataZoomComponent,
    titleComponent,
    visualMapComponent,
    graphicComponent,
    markLineComponent,
    toolboxComponent,
    transformComponent,
    timelineComponent,
  ] = await Promise.all([
    import("echarts/core.js"),
    import("echarts/lib/renderer/installCanvasRenderer.js"),
    import("echarts/lib/chart/line/install.js"),
    import("echarts/lib/chart/bar/install.js"),
    import("echarts/lib/chart/map/install.js"),
    import("echarts/lib/chart/heatmap/install.js"),
    import("echarts/lib/chart/scatter/install.js"),
    import("echarts/lib/component/grid/install.js"),
    import("echarts/lib/component/geo/install.js"),
    import("echarts/lib/component/tooltip/install.js"),
    import("echarts/lib/component/legend/install.js"),
    import("echarts/lib/component/dataZoom/install.js"),
    import("echarts/lib/component/title/install.js"),
    import("echarts/lib/component/visualMap/install.js"),
    import("echarts/lib/component/graphic/install.js"),
    import("echarts/lib/component/marker/installMarkLine.js"),
    import("echarts/lib/component/toolbox/install.js"),
    import("echarts/lib/component/transform/install.js"),
    import("echarts/lib/component/timeline/install.js"),
  ]) as any[];

  if (!registered) {
    echarts.use([
      canvasRenderer.install,
      lineChart.install,
      barChart.install,
      mapChart.install,
      heatmapChart.install,
      scatterChart.install,
      gridComponent.install,
      geoComponent.install,
      tooltipComponent.install,
      legendComponent.install,
      dataZoomComponent.install,
      titleComponent.install,
      visualMapComponent.install,
      graphicComponent.install,
      markLineComponent.install,
      toolboxComponent.install,
      transformComponent.install,
      timelineComponent.install,
    ]);
    registered = true;
  }

  return echarts as any;
}
