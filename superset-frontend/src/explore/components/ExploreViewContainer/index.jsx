/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint camelcase: 0 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
  styled,
  t,
  css,
  useTheme,
  logging,
  useChangeEffect,
  useComponentDidMount,
  usePrevious,
} from '@superset-ui/core';
import { debounce, isEqual, isObjectLike, omit, pick } from 'lodash';
import { Resizable } from 're-resizable';
import { Tooltip } from '@superset-ui/core/components';
import { usePluginContext } from 'src/components';
import { Global } from '@emotion/react';
import { Icons } from '@superset-ui/core/components/Icons';
import {
  getItem,
  setItem,
  LocalStorageKeys,
} from 'src/utils/localStorageHelpers';
import { RESERVED_CHART_URL_PARAMS, URL_PARAMS } from 'src/constants';
import { QUERY_MODE_REQUISITES } from 'src/explore/constants';
import { areObjectsEqual } from 'src/reduxUtils';
import * as logActions from 'src/logger/actions';
import {
  LOG_ACTIONS_MOUNT_EXPLORER,
  LOG_ACTIONS_CHANGE_EXPLORE_CONTROLS,
} from 'src/logger/LogUtils';
import { ensureAppRoot } from 'src/utils/pathUtils';
import { getUrlParam } from 'src/utils/urlUtils';
import cx from 'classnames';
import * as chartActions from 'src/components/Chart/chartAction';
import { fetchDatasourceMetadata } from 'src/dashboard/actions/datasources';
import { chartPropShape } from 'src/dashboard/util/propShapes';
import { mergeExtraFormData } from 'src/dashboard/components/nativeFilters/utils';
import { postFormData, putFormData } from 'src/explore/exploreUtils/formData';
import { datasourcesActions } from 'src/explore/actions/datasourcesActions';
import { mountExploreUrl } from 'src/explore/exploreUtils';
import { getFormDataFromControls } from 'src/explore/controlUtils';
import * as exploreActions from 'src/explore/actions/exploreActions';
import * as saveModalActions from 'src/explore/actions/saveModalActions';
import { useTabId } from 'src/hooks/useTabId';
import withToasts from 'src/components/MessageToasts/withToasts';
import ExploreChartPanel from '../ExploreChartPanel';
import ConnectedControlPanelsContainer from '../ControlPanelsContainer';
import SaveModal from '../SaveModal';
import DataSourcePanel from '../DatasourcePanel';
import ConnectedExploreChartHeader from '../ExploreChartHeader';
import ExploreContainer from '../ExploreContainer';

const propTypes = {
  ...ExploreChartPanel.propTypes,
  actions: PropTypes.object.isRequired,
  datasource_type: PropTypes.string.isRequired,
  dashboardId: PropTypes.number,
  colorScheme: PropTypes.string,
  ownColorScheme: PropTypes.string,
  dashboardColorScheme: PropTypes.string,
  isDatasourceMetaLoading: PropTypes.bool.isRequired,
  chart: chartPropShape.isRequired,
  slice: PropTypes.object,
  sliceName: PropTypes.string,
  controls: PropTypes.object.isRequired,
  forcedHeight: PropTypes.string,
  form_data: PropTypes.object.isRequired,
  standalone: PropTypes.bool.isRequired,
  force: PropTypes.bool,
  timeout: PropTypes.number,
  impressionId: PropTypes.string,
  vizType: PropTypes.string,
  saveAction: PropTypes.string,
  isSaveModalVisible: PropTypes.bool,
};

const ExplorePanelContainer = styled.div`
  ${({ theme }) => css`
    text-align: left;
    position: relative;
    width: 100%;
    max-height: 100%;
    background-color: ${theme.colorBgContainer};
    min-height: 0;
    display: flex;
    flex: 1;
    flex-wrap: nowrap;
    border-top: 1px solid ${theme.colorSplit};
    .explore-column {
      display: flex;
      flex-direction: column;
      padding: ${theme.sizeUnit * 2}px 0;
      max-height: 100%;
    }
    .data-source-selection {
      padding: ${theme.sizeUnit * 2}px 0;
      border-right: 1px solid ${theme.colorSplit};
    }
    .main-explore-content {
      flex: 1;
      min-width: ${theme.sizeUnit * 128}px;
      border-left: 1px solid ${theme.colorSplit};
      padding: 0 ${theme.sizeUnit * 4}px;
      .panel {
        margin-bottom: 0;
      }
    }
    .controls-column {
      align-self: flex-start;
      padding: 0;
    }
    .title-container {
      position: relative;
      display: flex;
      flex-direction: row;
      padding: 0 ${theme.sizeUnit * 2}px 0 ${theme.sizeUnit * 4}px;
      justify-content: space-between;
      .horizontal-text {
        font-size: ${theme.fontSize}px;
      }
    }
    .no-show {
      display: none;
    }
    .vertical-text {
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }
    .sidebar {
      height: 100%;
      padding: ${theme.sizeUnit * 2}px;
      width: ${theme.sizeUnit * 8}px;
    }
    .collapse-icon > svg {
      color: ${theme.colorPrimary};
    }
  `};
`;

const updateHistory = debounce(
  async (
    formData,
    datasourceId,
    datasourceType,
    isReplace,
    standalone,
    force,
    title,
    tabId,
  ) => {
    const payload = { ...formData };
    const chartId = formData.slice_id;
    const params = new URLSearchParams(window.location.search);
    const additionalParam = Object.fromEntries(params);

    if (chartId) {
      additionalParam[URL_PARAMS.sliceId.name] = chartId;
    } else {
      additionalParam[URL_PARAMS.datasourceId.name] = datasourceId;
      additionalParam[URL_PARAMS.datasourceType.name] = datasourceType;
    }

    const urlParams = payload?.url_params || {};
    Object.entries(urlParams).forEach(([key, value]) => {
      if (!RESERVED_CHART_URL_PARAMS.includes(key)) {
        additionalParam[key] = value;
      }
    });

    try {
      let key;
      let stateModifier;
      if (isReplace) {
        key = await postFormData(
          datasourceId,
          datasourceType,
          formData,
          chartId,
          tabId,
        );
        stateModifier = 'replaceState';
      } else {
        key = getUrlParam(URL_PARAMS.formDataKey);
        await putFormData(
          datasourceId,
          datasourceType,
          key,
          formData,
          chartId,
          tabId,
        );
        stateModifier = 'pushState';
      }
      // avoid race condition in case user changes route before explore updates the url
      if (window.location.pathname.startsWith(ensureAppRoot('/explore'))) {
        const url = mountExploreUrl(
          standalone ? URL_PARAMS.standalone.name : null,
          {
            [URL_PARAMS.formDataKey.name]: key,
            ...additionalParam,
          },
          force,
        );
        window.history[stateModifier](payload, title, url);
      }
    } catch (e) {
      logging.warn('Failed at altering browser history', e);
    }
  },
  1000,
);

const defaultSidebarsWidth = {
  controls_width: 320,
  datasource_width: 300,
};

function getSidebarWidths(key) {
  return getItem(key, defaultSidebarsWidth[key]);
}

function setSidebarWidths(key, dimension) {
  const newDimension = Number(getSidebarWidths(key)) + dimension.width;
  setItem(key, newDimension);
}

function ExploreViewContainer(props) {
  const dynamicPluginContext = usePluginContext();
  const dynamicPlugin = dynamicPluginContext.dynamicPlugins[props.vizType];
  const isDynamicPluginLoading = dynamicPlugin && dynamicPlugin.mounting;
  const wasDynamicPluginLoading = usePrevious(isDynamicPluginLoading);

  /** the state of controls in the previous render */
  const previousControls = usePrevious(props.controls);
  /** the state of controls last time a query was triggered */
  const [lastQueriedControls, setLastQueriedControls] = useState(
    props.controls,
  );

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [width, setWidth] = useState(
    getSidebarWidths(LocalStorageKeys.DatasourceWidth),
  );
  const tabId = useTabId();

  const theme = useTheme();

  useEffect(() => {
    if (props.sliceName) {
      document.title = props.sliceName;
    }
    return () => {
      document.title = 'Superset';
    };
  }, [props.sliceName]);

  const addHistory = useCallback(
    async ({ isReplace = false, title } = {}) => {
      const formData = props.dashboardId
        ? {
            ...props.form_data,
            dashboardId: props.dashboardId,
          }
        : props.form_data;
      const { id: datasourceId, type: datasourceType } = props.datasource;

      updateHistory(
        formData,
        datasourceId,
        datasourceType,
        isReplace,
        props.standalone,
        props.force,
        title,
        tabId,
      );
    },
    [
      props.dashboardId,
      props.form_data,
      props.datasource.id,
      props.datasource.type,
      props.standalone,
      props.force,
      tabId,
    ],
  );

  const handlePopstate = useCallback(() => {
    const formData = window.history.state;
    if (formData && Object.keys(formData).length) {
      props.actions.setExploreControls(formData);
      props.actions.postChartFormData(
        formData,
        props.force,
        props.timeout,
        props.chart.id,
      );
    }
  }, [props.actions, props.chart.id, props.timeout]);

  const onQuery = useCallback(() => {
    props.actions.setForceQuery(false);
    props.actions.triggerQuery(true, props.chart.id);
    addHistory();
    setLastQueriedControls(props.controls);
  }, [props.controls, addHistory, props.actions, props.chart.id]);

  const handleKeydown = useCallback(
    event => {
      const controlOrCommand = event.ctrlKey || event.metaKey;
      if (controlOrCommand) {
        const isEnter = event.key === 'Enter' || event.keyCode === 13;
        const isS = event.key === 's' || event.keyCode === 83;
        if (isEnter) {
          onQuery();
        } else if (isS) {
          if (props.slice) {
            props.actions
              .saveSlice(props.form_data, {
                action: 'overwrite',
                slice_id: props.slice.slice_id,
                slice_name: props.slice.slice_name,
                add_to_dash: 'noSave',
                goto_dash: false,
              })
              .then(({ data }) => {
                window.location = data.slice.slice_url;
              });
          }
        }
      }
    },
    [onQuery, props.actions, props.form_data, props.slice],
  );

  function onStop() {
    if (props.chart && props.chart.queryController) {
      props.chart.queryController.abort();
    }
  }

  function toggleCollapse() {
    setIsCollapsed(!isCollapsed);
  }

  useComponentDidMount(() => {
    props.actions.logEvent(
      LOG_ACTIONS_MOUNT_EXPLORER,
      props.slice?.slice_id
        ? {
            slice_id: props.slice.slice_id,
          }
        : undefined,
    );
  });

  useChangeEffect(tabId, (previous, current) => {
    if (current) {
      addHistory({ isReplace: true });
    }
  });

  const previousHandlePopstate = usePrevious(handlePopstate);
  useEffect(() => {
    if (previousHandlePopstate) {
      window.removeEventListener('popstate', previousHandlePopstate);
    }
    window.addEventListener('popstate', handlePopstate);
    return () => {
      window.removeEventListener('popstate', handlePopstate);
    };
  }, [handlePopstate, previousHandlePopstate]);

  const previousHandleKeyDown = usePrevious(handleKeydown);
  useEffect(() => {
    if (previousHandleKeyDown) {
      window.removeEventListener('keydown', previousHandleKeyDown);
    }
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [handleKeydown, previousHandleKeyDown]);

  useEffect(() => {
    if (wasDynamicPluginLoading && !isDynamicPluginLoading) {
      // reload the controls now that we actually have the control config
      props.actions.dynamicPluginControlsReady();
    }
  }, [isDynamicPluginLoading]);

  useEffect(() => {
    const hasError = Object.values(props.controls).some(
      control =>
        control.validationErrors && control.validationErrors.length > 0,
    );
    if (!hasError) {
      props.actions.triggerQuery(true, props.chart.id);
    }
  }, []);

  const reRenderChart = useCallback(
    controlsChanged => {
      const newQueryFormData = controlsChanged
        ? {
            ...props.chart.latestQueryFormData,
            ...getFormDataFromControls(pick(props.controls, controlsChanged)),
          }
        : getFormDataFromControls(props.controls);
      props.actions.updateQueryFormData(newQueryFormData, props.chart.id);
      props.actions.renderTriggered(new Date().getTime(), props.chart.id);
      addHistory();
    },
    [
      addHistory,
      props.actions,
      props.chart.id,
      props.chart.latestQueryFormData,
      props.controls,
    ],
  );

  // effect to run when controls change
  useEffect(() => {
    if (
      previousControls &&
      props.chart.latestQueryFormData.viz_type === props.controls.viz_type.value
    ) {
      if (
        props.controls.datasource &&
        (previousControls.datasource == null ||
          props.controls.datasource.value !== previousControls.datasource.value)
      ) {
        // this should really be handled by actions
        fetchDatasourceMetadata(props.form_data.datasource, true);
      }

      const changedControlKeys = Object.keys(props.controls).filter(
        key =>
          typeof previousControls[key] !== 'undefined' &&
          !areObjectsEqual(
            props.controls[key].value,
            previousControls[key].value,
          ),
      );

      // this should also be handled by the actions that are actually changing the controls
      const displayControlsChanged = changedControlKeys.filter(
        key => props.controls[key].renderTrigger,
      );
      if (displayControlsChanged.length > 0) {
        reRenderChart(displayControlsChanged);
      }
    }
  }, [props.controls, props.ownState]);

  const chartIsStale = useMemo(() => {
    if (lastQueriedControls) {
      const { controls } = props;
      const changedControlKeys = Object.keys(controls).filter(key => {
        const lastControl = lastQueriedControls[key];
        if (typeof lastControl === 'undefined') {
          return false;
        }
        const { value: value1 } = controls[key];
        const { value: value2 } = lastControl;
        if (isObjectLike(value1) && isObjectLike(value2)) {
          return !areObjectsEqual(value1, value2, {
            ignoreFields: ['datasourceWarning'],
          });
        }
        return !isEqual(value1, value2);
      });

      return changedControlKeys.some(
        key =>
          !props.controls[key].renderTrigger &&
          !props.controls[key].dontRefreshOnChange,
      );
    }
    return false;
  }, [lastQueriedControls, props.controls]);

  useChangeEffect(props.saveAction, () => {
    if (['saveas', 'overwrite'].includes(props.saveAction)) {
      onQuery();
      addHistory({ isReplace: true });
      props.actions.setSaveAction(null);
    }
  });

  useEffect(() => {
    if (props.ownState !== undefined) {
      onQuery();
      reRenderChart();
    }
  }, [props.ownState]);

  if (chartIsStale) {
    props.actions.logEvent(LOG_ACTIONS_CHANGE_EXPLORE_CONTROLS);
  }

  const errorMessage = useMemo(() => {
    const controlsWithErrors = Object.values(props.controls).filter(
      control =>
        control.validationErrors && control.validationErrors.length > 0,
    );
    if (controlsWithErrors.length === 0) {
      return null;
    }

    const errorMessages = controlsWithErrors.map(
      control => control.validationErrors,
    );
    const uniqueErrorMessages = [...new Set(errorMessages.flat())];

    const errors = uniqueErrorMessages
      .map(message => {
        const matchingLabels = controlsWithErrors
          .filter(control => control.validationErrors?.includes(message))
          .map(control => control.label);
        return [matchingLabels, message];
      })
      .map(([labels, message]) => (
        <div key={message}>
          {labels.length > 1 ? t('Controls labeled ') : t('Control labeled ')}
          <strong>{` ${labels.join(', ')}`}</strong>
          <span>: {message}</span>
        </div>
      ));

    let errorMessage;
    if (errors.length > 0) {
      errorMessage = <div style={{ textAlign: 'left' }}>{errors}</div>;
    }
    return errorMessage;
  }, [props.controls]);

  function renderChartContainer() {
    return (
      <ExploreChartPanel
        {...props}
        errorMessage={errorMessage}
        chartIsStale={chartIsStale}
        onQuery={onQuery}
      />
    );
  }

  if (props.standalone) {
    return renderChartContainer();
  }

  return (
    <ExploreContainer>
      <ConnectedExploreChartHeader
        actions={props.actions}
        canOverwrite={props.can_overwrite}
        canDownload={props.can_download}
        dashboardId={props.dashboardId}
        colorScheme={props.dashboardColorScheme}
        isStarred={props.isStarred}
        slice={props.slice}
        sliceName={props.sliceName}
        table_name={props.table_name}
        formData={props.form_data}
        chart={props.chart}
        ownState={props.ownState}
        user={props.user}
        reports={props.reports}
        saveDisabled={errorMessage || props.chart.chartStatus === 'loading'}
        metadata={props.metadata}
        isSaveModalVisible={props.isSaveModalVisible}
      />
      <ExplorePanelContainer id="explore-container">
        <Global
          styles={css`
            .navbar {
              margin-bottom: 0;
            }
            body {
              height: 100vh;
              max-height: 100vh;
              overflow: hidden;
            }
            #app-menu,
            #app {
              flex: 1 1 auto;
            }
            #app {
              flex-basis: 100%;
              overflow: hidden;
              height: 100%;
            }
            #app-menu {
              flex-shrink: 0;
            }
          `}
        />
        <Resizable
          onResizeStop={(evt, direction, ref, d) => {
            setWidth(ref.getBoundingClientRect().width);
            setSidebarWidths(LocalStorageKeys.DatasourceWidth, d);
          }}
          defaultSize={{
            width: getSidebarWidths(LocalStorageKeys.DatasourceWidth),
            height: '100%',
          }}
          minWidth={defaultSidebarsWidth[LocalStorageKeys.DatasourceWidth]}
          maxWidth="33%"
          enable={{ right: true }}
          className={
            isCollapsed ? 'no-show' : 'explore-column data-source-selection'
          }
        >
          <div className="title-container">
            <span className="horizontal-text">{t('Chart Source')}</span>
            <span
              role="button"
              tabIndex={0}
              className="action-button"
              onClick={toggleCollapse}
            >
              <Icons.VerticalAlignTopOutlined
                iconSize="xl"
                css={css`
                  transform: rotate(-90deg);
                `}
                className="collapse-icon"
                iconColor={theme.colorPrimary}
              />
            </span>
          </div>
          <DataSourcePanel
            formData={props.form_data}
            datasource={props.datasource}
            controls={props.controls}
            actions={props.actions}
            width={width}
            user={props.user}
          />
        </Resizable>
        {isCollapsed ? (
          <div
            className="sidebar"
            onClick={toggleCollapse}
            data-test="open-datasource-tab"
            role="button"
            tabIndex={0}
          >
            <span role="button" tabIndex={0} className="action-button">
              <Tooltip title={t('Open Datasource tab')}>
                <Icons.VerticalAlignTopOutlined
                  iconSize="xl"
                  css={css`
                    transform: rotate(90deg);
                  `}
                  className="collapse-icon"
                  iconColor={theme.colorPrimary}
                />
              </Tooltip>
            </span>
          </div>
        ) : null}
        <Resizable
          onResizeStop={(evt, direction, ref, d) =>
            setSidebarWidths(LocalStorageKeys.ControlsWidth, d)
          }
          defaultSize={{
            width: getSidebarWidths(LocalStorageKeys.ControlsWidth),
            height: '100%',
          }}
          minWidth={defaultSidebarsWidth[LocalStorageKeys.ControlsWidth]}
          maxWidth="33%"
          enable={{ right: true }}
          className="col-sm-3 explore-column controls-column"
        >
          <ConnectedControlPanelsContainer
            exploreState={props.exploreState}
            actions={props.actions}
            form_data={props.form_data}
            controls={props.controls}
            chart={props.chart}
            datasource_type={props.datasource_type}
            isDatasourceMetaLoading={props.isDatasourceMetaLoading}
            onQuery={onQuery}
            onStop={onStop}
            canStopQuery={props.can_add || props.can_overwrite}
            errorMessage={errorMessage}
            chartIsStale={chartIsStale}
          />
        </Resizable>
        <div
          className={cx(
            'main-explore-content',
            isCollapsed ? 'col-sm-9' : 'col-sm-7',
          )}
        >
          {renderChartContainer()}
        </div>
      </ExplorePanelContainer>
      {props.isSaveModalVisible && (
        <SaveModal
          addDangerToast={props.addDangerToast}
          actions={props.actions}
          form_data={props.form_data}
          sliceName={props.sliceName}
          dashboardId={props.dashboardId}
        />
      )}
    </ExploreContainer>
  );
}

ExploreViewContainer.propTypes = propTypes;

const retainQueryModeRequirements = hiddenFormData =>
  Object.keys(hiddenFormData ?? {}).filter(
    key => !QUERY_MODE_REQUISITES.has(key),
  );

function patchBigNumberTotalFormData(form_data, slice) {
  if (
    form_data.viz_type === 'big_number_total' &&
    !form_data.subtitle &&
    slice?.form_data?.subheader
  ) {
    return { ...form_data, subtitle: slice.form_data.subheader };
  }
  return form_data;
}

function mapStateToProps(state) {
  const {
    explore,
    charts,
    common,
    impressionId,
    dataMask,
    reports,
    user,
    saveModal,
  } = state;
  const { controls, slice, datasource, metadata, hiddenFormData } = explore;
  const hasQueryMode = !!controls.query_mode?.value;
  const fieldsToOmit = hasQueryMode
    ? retainQueryModeRequirements(hiddenFormData)
    : Object.keys(hiddenFormData ?? {});

  const controlsBasedFormData = omit(
    getFormDataFromControls(controls),
    fieldsToOmit,
  );
  const isDeckGLChart = explore.form_data?.viz_type === 'deck_multi';

  const getDeckGLFormData = () => {
    const formData = { ...controlsBasedFormData };

    if (explore.form_data?.layer_filter_scope) {
      formData.layer_filter_scope = explore.form_data.layer_filter_scope;
    }

    if (explore.form_data?.filter_data_mapping) {
      formData.filter_data_mapping = explore.form_data.filter_data_mapping;
    }

    return formData;
  };

  const form_data = isDeckGLChart ? getDeckGLFormData() : controlsBasedFormData;

  const slice_id = form_data.slice_id ?? slice?.slice_id ?? 0; // 0 - unsaved chart
  form_data.extra_form_data = mergeExtraFormData(
    { ...form_data.extra_form_data },
    {
      ...dataMask[slice_id]?.ownState,
    },
  );
  const chart = charts[slice_id];
  const colorScheme = explore.form_data?.color_scheme;
  const ownColorScheme = explore.form_data?.own_color_scheme;
  const dashboardColorScheme = explore.form_data?.dashboard_color_scheme;

  let dashboardId = Number(explore.form_data?.dashboardId);
  if (Number.isNaN(dashboardId)) {
    dashboardId = undefined;
  }

  if (
    form_data.viz_type === 'big_number_total' &&
    slice?.form_data?.subheader &&
    (!controls.subtitle?.value || controls.subtitle.value === '')
  ) {
    controls.subtitle = {
      ...controls.subtitle,
      value: slice.form_data.subheader,
    };
    if (slice?.form_data?.subheader_font_size) {
      controls.subtitle_font_size = {
        ...controls.subtitle_font_size,
        value: slice.form_data.subheader_font_size,
      };
    }
  }

  const patchedFormData = patchBigNumberTotalFormData(form_data, slice);

  return {
    isDatasourceMetaLoading: explore.isDatasourceMetaLoading,
    datasource,
    datasource_type: datasource.type,
    datasourceId: datasource.datasource_id,
    dashboardId,
    colorScheme,
    ownColorScheme,
    dashboardColorScheme,
    controls: explore.controls,
    can_add: !!explore.can_add,
    can_download: !!explore.can_download,
    can_overwrite: !!explore.can_overwrite,
    column_formats: datasource?.column_formats ?? null,
    containerId: slice
      ? `slice-container-${slice.slice_id}`
      : 'slice-container',
    isStarred: explore.isStarred,
    slice,
    sliceName: explore.sliceName ?? slice?.slice_name ?? null,
    triggerRender: explore.triggerRender,
    form_data: patchedFormData,
    table_name: datasource.table_name,
    vizType: form_data.viz_type,
    standalone: !!explore.standalone,
    force: !!explore.force,
    chart,
    timeout: common.conf.SUPERSET_WEBSERVER_TIMEOUT,
    ownState: dataMask[slice_id]?.ownState,
    impressionId,
    user,
    exploreState: explore,
    reports,
    metadata,
    saveAction: explore.saveAction,
    isSaveModalVisible: saveModal.isVisible,
  };
}

function mapDispatchToProps(dispatch) {
  const actions = {
    ...exploreActions,
    ...datasourcesActions,
    ...saveModalActions,
    ...chartActions,
    ...logActions,
  };
  return {
    actions: bindActionCreators(actions, dispatch),
  };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(withToasts(memo(ExploreViewContainer)));
